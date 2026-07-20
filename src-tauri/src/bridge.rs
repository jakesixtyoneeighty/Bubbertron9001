//! Bridge server for bubbertron9001 <-> Roblox Studio plugin communication.
//!
//! The Roblox Studio plugin cannot receive incoming HTTP requests, only make them.
//! This bridge server acts as an intermediary:
//!
//! 1. bubbertron9001 tools POST requests to `/bubbertron9001/request`
//! 2. Studio plugin polls `/bubbertron9001/poll` for pending requests
//! 3. Studio plugin responds to `/bubbertron9001/respond` with results
//! 4. The original request resolves with the result
//!
//! The legacy `/stud/*` endpoints remain aliases during migration.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::oneshot;
use warp::Filter;

const BRIDGE_PORT: u16 = 3001;
const OAUTH_PORT: u16 = 1455;
const OAUTH_CALLBACK_TTL_MS: u64 = 5 * 60 * 1000;
const MAX_OAUTH_CODE_BYTES: usize = 16 * 1024;
const MAX_OAUTH_STATE_BYTES: usize = 1024;
const STUDIO_SESSION_TIMEOUT_SECS: u64 = 20;
const REQUEST_TIMEOUT_SECS: u64 = 15;
// Leave a small server-side margin beyond the desktop client's 60-second cap
// so its cancellation request wins the timeout race and the operation remains
// queryable if Studio reports a late completion.
const GAME_INSTALL_TIMEOUT_SECS: u64 = 65;
const MAX_PENDING_REQUESTS: usize = 64;
const MAX_BRIDGE_REQUEST_BYTES: u64 = 2 * 1024 * 1024;
const MAX_BRIDGE_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_SESSION_CONTROL_BYTES: u64 = 4 * 1024;
const MAX_REQUEST_PATH_BYTES: usize = 256;
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_OPERATION_ID_BYTES: usize = 128;
const MAX_SESSION_ID_BYTES: usize = 128;
const MAX_OPERATION_HISTORY: usize = 256;
const PAIRING_SECRET_HEADER: &str = "x-bubbertron9001-secret";
const PREVIOUS_PAIRING_SECRET_HEADER: &str = "x-bubberton9001-secret";

// Global storage for OAuth callback data
lazy_static::lazy_static! {
    static ref OAUTH_CALLBACK_DATA: Arc<Mutex<Option<OAuthCallbackData>>> = Arc::new(Mutex::new(None));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthCallbackData {
    pub code: String,
    pub state: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioRequest {
    pub path: String,
    pub body: Option<String>,
    #[serde(default)]
    pub operation_id: Option<String>,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub step_id: Option<String>,
    #[serde(default)]
    pub capability: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PollResponse {
    pub id: Option<String>,
    pub request: Option<StudioRequest>,
    pub session_conflict: bool,
    pub pairing_error: bool,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PollQuery {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SessionRequest {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
pub struct OperationRequest {
    pub operation_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RespondRequest {
    pub id: String,
    pub session_id: String,
    pub response: StudioResponse,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StatusResponse {
    pub connected: bool,
    pub pending_requests: usize,
    pub last_poll_time: u64,
}

struct PendingRequest {
    request: StudioRequest,
    operation_id: String,
    sender: oneshot::Sender<StudioResponse>,
    timestamp: Instant,
    leased_session_id: Option<String>,
    cancel_requested: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum OperationStatus {
    Queued,
    Leased,
    Completed,
    Failed,
    CancelRequested,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
struct OperationRecord {
    operation_id: String,
    request_id: String,
    status: OperationStatus,
    leased: bool,
    may_complete: bool,
    completed_after_cancel: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum EnqueueError {
    QueueFull,
    DuplicateOperation,
}

struct ActiveStudioSession {
    id: String,
    last_seen: Instant,
}

#[derive(Debug, PartialEq, Eq)]
enum CompleteRequestError {
    NotFound,
    NotLeased,
    WrongSession,
}

struct BridgeState {
    pending_requests: HashMap<String, PendingRequest>,
    request_queue: VecDeque<String>,
    operation_records: HashMap<String, OperationRecord>,
    operation_order: VecDeque<String>,
    active_session: Option<ActiveStudioSession>,
}

impl BridgeState {
    fn new() -> Self {
        Self {
            pending_requests: HashMap::new(),
            request_queue: VecDeque::new(),
            operation_records: HashMap::new(),
            operation_order: VecDeque::new(),
            active_session: None,
        }
    }

    fn is_connected(&self) -> bool {
        self.active_session.is_some()
    }

    fn last_poll_elapsed_ms(&self) -> u64 {
        self.active_session
            .as_ref()
            .map(|session| session.last_seen.elapsed().as_millis() as u64)
            .unwrap_or(STUDIO_SESSION_TIMEOUT_SECS * 1000)
    }

    fn admit_session(&mut self, session_id: &str) -> bool {
        self.expire_active_session();

        match self.active_session.as_mut() {
            Some(active) if active.id == session_id => {
                active.last_seen = Instant::now();
                true
            }
            Some(_) => false,
            None => {
                self.active_session = Some(ActiveStudioSession {
                    id: session_id.to_string(),
                    last_seen: Instant::now(),
                });
                true
            }
        }
    }

    fn expire_active_session(&mut self) {
        let timeout = Duration::from_secs(STUDIO_SESSION_TIMEOUT_SECS);
        if self
            .active_session
            .as_ref()
            .is_some_and(|session| session.last_seen.elapsed() >= timeout)
        {
            self.active_session = None;
        }
    }

    fn release_session(&mut self, session_id: &str) -> bool {
        if self
            .active_session
            .as_ref()
            .is_some_and(|active| active.id == session_id)
        {
            self.active_session = None;
            true
        } else {
            false
        }
    }

    fn enqueue(
        &mut self,
        mut request: StudioRequest,
        sender: oneshot::Sender<StudioResponse>,
    ) -> Result<String, EnqueueError> {
        self.cleanup_stale();
        if self.pending_requests.len() >= MAX_PENDING_REQUESTS {
            return Err(EnqueueError::QueueFull);
        }

        let operation_id = request
            .operation_id
            .clone()
            .unwrap_or_else(|| format!("op_{}", uuid::Uuid::new_v4()));
        if self.operation_records.contains_key(&operation_id) {
            return Err(EnqueueError::DuplicateOperation);
        }
        request.operation_id = Some(operation_id.clone());
        let id = format!("req_{}", uuid::Uuid::new_v4());
        self.pending_requests.insert(
            id.clone(),
            PendingRequest {
                request,
                operation_id: operation_id.clone(),
                sender,
                timestamp: Instant::now(),
                leased_session_id: None,
                cancel_requested: false,
            },
        );
        self.record_operation(OperationRecord {
            operation_id,
            request_id: id.clone(),
            status: OperationStatus::Queued,
            leased: false,
            may_complete: false,
            completed_after_cancel: false,
        });
        self.request_queue.push_back(id.clone());
        Ok(id)
    }

    /// Lease each request at most once. A missing response is allowed to time out rather
    /// than risking a repeated mutation in Studio.
    fn lease_next(&mut self, session_id: &str) -> Option<(String, StudioRequest)> {
        self.cleanup_stale();

        while let Some(id) = self.request_queue.pop_front() {
            if let Some(pending) = self.pending_requests.get_mut(&id) {
                if pending.leased_session_id.is_none() {
                    pending.leased_session_id = Some(session_id.to_string());
                    if let Some(record) = self.operation_records.get_mut(&pending.operation_id) {
                        record.status = OperationStatus::Leased;
                        record.leased = true;
                    }
                    return Some((id, pending.request.clone()));
                }
            }
        }

        None
    }

    fn complete_request(
        &mut self,
        request_id: &str,
        session_id: &str,
        response_status: u16,
    ) -> Result<PendingRequest, CompleteRequestError> {
        let pending = self
            .pending_requests
            .get(request_id)
            .ok_or(CompleteRequestError::NotFound)?;

        match pending.leased_session_id.as_deref() {
            None => return Err(CompleteRequestError::NotLeased),
            Some(owner) if owner != session_id => {
                return Err(CompleteRequestError::WrongSession);
            }
            Some(_) => {}
        }

        let completed = self
            .pending_requests
            .remove(request_id)
            .ok_or(CompleteRequestError::NotFound)?;
        if let Some(record) = self.operation_records.get_mut(&completed.operation_id) {
            record.status = if (200..=299).contains(&response_status) {
                OperationStatus::Completed
            } else {
                OperationStatus::Failed
            };
            record.completed_after_cancel = completed.cancel_requested;
            record.may_complete = false;
        }
        Ok(completed)
    }

    fn cancel_operation(&mut self, operation_id: &str) -> OperationRecord {
        self.cleanup_stale();
        let record = self
            .operation_records
            .get(operation_id)
            .cloned()
            .unwrap_or_else(|| {
                let record = OperationRecord {
                    operation_id: operation_id.to_string(),
                    request_id: String::new(),
                    status: OperationStatus::Cancelled,
                    leased: false,
                    may_complete: false,
                    completed_after_cancel: false,
                };
                self.record_operation(record.clone());
                record
            });

        let pending_id = self
            .pending_requests
            .iter()
            .find_map(|(id, pending)| (pending.operation_id == operation_id).then(|| id.clone()));

        let Some(pending_id) = pending_id else {
            return record;
        };
        let leased = self
            .pending_requests
            .get(&pending_id)
            .is_some_and(|pending| pending.leased_session_id.is_some());

        if leased {
            if let Some(pending) = self.pending_requests.get_mut(&pending_id) {
                pending.cancel_requested = true;
                pending.timestamp = Instant::now();
            }
            if let Some(record) = self.operation_records.get_mut(operation_id) {
                record.status = OperationStatus::CancelRequested;
                record.leased = true;
                record.may_complete = true;
                return record.clone();
            }
        } else {
            self.pending_requests.remove(&pending_id);
            self.request_queue.retain(|id| id != &pending_id);
            if let Some(record) = self.operation_records.get_mut(operation_id) {
                record.status = OperationStatus::Cancelled;
                record.may_complete = false;
                return record.clone();
            }
        }

        record
    }

    fn record_operation(&mut self, record: OperationRecord) {
        let operation_id = record.operation_id.clone();
        self.operation_records.insert(operation_id.clone(), record);
        self.operation_order.push_back(operation_id);
        while self.operation_order.len() > MAX_OPERATION_HISTORY {
            let removable_index = self.operation_order.iter().position(|candidate| {
                !self
                    .pending_requests
                    .values()
                    .any(|pending| pending.operation_id == *candidate)
            });
            let Some(removable_index) = removable_index else {
                break;
            };
            if let Some(expired) = self.operation_order.remove(removable_index) {
                self.operation_records.remove(&expired);
            }
        }
    }

    fn fail_request(&mut self, request_id: &str) {
        if let Some(pending) = self.pending_requests.remove(request_id) {
            if let Some(record) = self.operation_records.get_mut(&pending.operation_id) {
                record.status = if pending.cancel_requested {
                    OperationStatus::Cancelled
                } else {
                    OperationStatus::Failed
                };
                record.may_complete = false;
            }
        }
        self.request_queue.retain(|id| id != request_id);
    }

    fn timeout_request(&mut self, request_id: &str) {
        let Some(pending) = self.pending_requests.get_mut(request_id) else {
            return;
        };
        if pending.leased_session_id.is_none() {
            self.fail_request(request_id);
            return;
        }

        pending.cancel_requested = true;
        pending.timestamp = Instant::now();
        if let Some(record) = self.operation_records.get_mut(&pending.operation_id) {
            record.status = OperationStatus::CancelRequested;
            record.leased = true;
            record.may_complete = true;
        }
    }

    fn cleanup_stale(&mut self) {
        self.expire_active_session();
        let stale = self
            .pending_requests
            .iter()
            .filter(|(_, pending)| {
                pending.timestamp.elapsed() > request_timeout(&pending.request.path)
            })
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in stale {
            self.fail_request(&id);
        }
    }
}

fn request_timeout(path: &str) -> Duration {
    Duration::from_secs(if path == "/game/install" {
        GAME_INSTALL_TIMEOUT_SECS
    } else {
        REQUEST_TIMEOUT_SECS
    })
}

fn chrono_lite_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn oauth_callback_is_fresh(callback: &OAuthCallbackData, now_ms: u64) -> bool {
    now_ms.saturating_sub(callback.timestamp) < OAUTH_CALLBACK_TTL_MS
}

fn valid_oauth_callback(code: &str, state: &str) -> bool {
    !code.is_empty()
        && code.len() <= MAX_OAUTH_CODE_BYTES
        && !state.is_empty()
        && state.len() <= MAX_OAUTH_STATE_BYTES
}

fn valid_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id.len() <= MAX_SESSION_ID_BYTES
        && session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_context_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_OPERATION_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn valid_request_context(request: &StudioRequest) -> bool {
    request.operation_id.as_deref().is_none_or(valid_context_id)
        && request.run_id.as_deref().is_none_or(valid_context_id)
        && request.owner_id.as_deref().is_none_or(valid_context_id)
        && request.step_id.as_deref().is_none_or(valid_context_id)
        && request
            .capability
            .as_deref()
            .is_none_or(|value| matches!(value, "read" | "mutation" | "template_install"))
        && request
            .target
            .as_deref()
            .is_none_or(|value| !value.is_empty() && value.len() <= 512)
}

fn pairing_secret_matches(provided: Option<&str>) -> bool {
    let Some(provided) = provided else {
        return false;
    };
    let expected = crate::plugin::pairing_secret().as_bytes();
    let provided = provided.as_bytes();
    if provided.len() != expected.len() {
        return false;
    }

    provided
        .iter()
        .zip(expected)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

type SharedState = Arc<Mutex<BridgeState>>;

fn with_state(
    state: SharedState,
) -> impl Filter<Extract = (SharedState,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || state.clone())
}

fn bridge_namespace() -> impl Filter<Extract = (), Error = warp::Rejection> + Clone {
    warp::path("bubbertron9001")
        .or(warp::path("bubberton9001"))
        .unify()
        .or(warp::path("stud"))
        .unify()
}

fn pairing_secret_header(
) -> impl Filter<Extract = (Option<String>,), Error = warp::Rejection> + Clone {
    warp::header::optional::<String>(PAIRING_SECRET_HEADER)
        .and(warp::header::optional::<String>(
            PREVIOUS_PAIRING_SECRET_HEADER,
        ))
        .map(|current: Option<String>, previous: Option<String>| current.or(previous))
}

fn cors() -> warp::cors::Builder {
    warp::cors()
        .allow_origins([
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "http://localhost:1430",
            "http://127.0.0.1:1430",
            "http://[::1]:1430",
        ])
        .allow_methods(vec!["GET", "POST", "OPTIONS"])
        .allow_headers(vec![
            "Content-Type",
            "Authorization",
            "ChatGPT-Account-Id",
            "X-bubbertron9001-Secret",
            "X-bubberton9001-Secret",
        ])
}

fn status_reply(
    provided_secret: Option<String>,
    state: SharedState,
) -> warp::reply::WithStatus<warp::reply::Json> {
    if !pairing_secret_matches(provided_secret.as_deref()) {
        return warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Bridge authentication failed"})),
            warp::http::StatusCode::UNAUTHORIZED,
        );
    }

    let mut state = state.lock();
    state.cleanup_stale();
    let response = StatusResponse {
        connected: state.is_connected(),
        pending_requests: state.pending_requests.len(),
        last_poll_time: state.last_poll_elapsed_ms(),
    };
    warp::reply::with_status(warp::reply::json(&response), warp::http::StatusCode::OK)
}

pub async fn start_bridge_server() {
    let state: SharedState = Arc::new(Mutex::new(BridgeState::new()));

    // Status endpoint
    let status = bridge_namespace()
        .and(warp::path("status"))
        .and(warp::path::end())
        .and(warp::get())
        .and(pairing_secret_header())
        .and(with_state(state.clone()))
        .map(status_reply);

    // Request endpoint - bubbertron9001 sends requests here
    let request = bridge_namespace()
        .and(warp::path("request"))
        .and(warp::path::end())
        .and(warp::post())
        .and(pairing_secret_header())
        .and(warp::body::content_length_limit(MAX_BRIDGE_REQUEST_BYTES))
        .and(warp::body::json())
        .and(with_state(state.clone()))
        .and_then(handle_request);

    // Poll endpoint - Studio plugin polls here
    let poll = bridge_namespace()
        .and(warp::path("poll"))
        .and(warp::path::end())
        .and(warp::get())
        .and(pairing_secret_header())
        .and(warp::query::<PollQuery>())
        .and(with_state(state.clone()))
        .map(
            |provided_secret: Option<String>, query: PollQuery, state: SharedState| {
                if !pairing_secret_matches(provided_secret.as_deref()) {
                    return warp::reply::with_status(
                        warp::reply::json(&PollResponse {
                            id: None,
                            request: None,
                            session_conflict: false,
                            pairing_error: true,
                            message: Some(
                                "Studio plugin pairing failed. Reinstall it from bubbertron9001."
                                    .to_string(),
                            ),
                        }),
                        warp::http::StatusCode::UNAUTHORIZED,
                    );
                }

                let mut state = state.lock();

                if !valid_session_id(&query.session_id) {
                    return warp::reply::with_status(
                        warp::reply::json(&PollResponse {
                            id: None,
                            request: None,
                            session_conflict: true,
                            pairing_error: false,
                            message: Some("Invalid Studio session ID.".to_string()),
                        }),
                        warp::http::StatusCode::BAD_REQUEST,
                    );
                }

                if !state.admit_session(&query.session_id) {
                    return warp::reply::with_status(
                        warp::reply::json(&PollResponse {
                            id: None,
                            request: None,
                            session_conflict: true,
                            pairing_error: false,
                            message: Some(
                                "Another Roblox Studio window is connected to bubbertron9001."
                                    .to_string(),
                            ),
                        }),
                        warp::http::StatusCode::OK,
                    );
                }

                let response = if let Some((id, request)) = state.lease_next(&query.session_id) {
                    PollResponse {
                        id: Some(id),
                        request: Some(request),
                        session_conflict: false,
                        pairing_error: false,
                        message: None,
                    }
                } else {
                    PollResponse {
                        id: None,
                        request: None,
                        session_conflict: false,
                        pairing_error: false,
                        message: None,
                    }
                };

                warp::reply::with_status(warp::reply::json(&response), warp::http::StatusCode::OK)
            },
        );

    // Respond endpoint - Studio plugin responds here
    let respond = bridge_namespace()
        .and(warp::path("respond"))
        .and(warp::path::end())
        .and(warp::post())
        .and(pairing_secret_header())
        .and(warp::body::content_length_limit(MAX_BRIDGE_RESPONSE_BYTES))
        .and(warp::body::json())
        .and(with_state(state.clone()))
        .map(
            |provided_secret: Option<String>, body: RespondRequest, state: SharedState| {
                if !pairing_secret_matches(provided_secret.as_deref()) {
                    return warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({"error": "Plugin pairing failed"})),
                        warp::http::StatusCode::UNAUTHORIZED,
                    );
                }

            if body.id.is_empty() || body.id.len() > MAX_REQUEST_ID_BYTES {
                return warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"error": "Invalid request ID"})),
                    warp::http::StatusCode::BAD_REQUEST,
                );
            }
            if !valid_session_id(&body.session_id) {
                return warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"error": "Invalid Studio session ID"})),
                    warp::http::StatusCode::BAD_REQUEST,
                );
            }
            if !(100..=599).contains(&body.response.status) {
                return warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"error": "Invalid response status"})),
                    warp::http::StatusCode::BAD_REQUEST,
                );
            }

            let mut state = state.lock();

            match state.complete_request(&body.id, &body.session_id, body.response.status) {
                Ok(pending) => {
                    let _ = pending.sender.send(body.response);
                    warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({"ok": true})),
                        warp::http::StatusCode::OK,
                    )
                }
                Err(CompleteRequestError::NotFound) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"error": "Request not found"})),
                    warp::http::StatusCode::NOT_FOUND,
                ),
                Err(CompleteRequestError::NotLeased) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"error": "Request has not been leased"})),
                    warp::http::StatusCode::CONFLICT,
                ),
                Err(CompleteRequestError::WrongSession) => warp::reply::with_status(
                    warp::reply::json(
                        &serde_json::json!({"error": "Request belongs to another Studio session"}),
                    ),
                    warp::http::StatusCode::CONFLICT,
                ),
            }
            },
        );

    let cancel_operation = bridge_namespace()
        .and(warp::path("operation"))
        .and(warp::path("cancel"))
        .and(warp::path::end())
        .and(warp::post())
        .and(pairing_secret_header())
        .and(warp::body::content_length_limit(MAX_SESSION_CONTROL_BYTES))
        .and(warp::body::json())
        .and(with_state(state.clone()))
        .map(
            |provided_secret: Option<String>, body: OperationRequest, state: SharedState| {
                if !pairing_secret_matches(provided_secret.as_deref()) {
                    return warp::reply::with_status(
                        warp::reply::json(
                            &serde_json::json!({"error": "Bridge authentication failed"}),
                        ),
                        warp::http::StatusCode::UNAUTHORIZED,
                    );
                }
                if !valid_context_id(&body.operation_id) {
                    return warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({"error": "Invalid operation ID"})),
                        warp::http::StatusCode::BAD_REQUEST,
                    );
                }

                let record = state.lock().cancel_operation(&body.operation_id);
                warp::reply::with_status(warp::reply::json(&record), warp::http::StatusCode::OK)
            },
        );

    let operation_status = bridge_namespace()
        .and(warp::path("operation"))
        .and(warp::path("status"))
        .and(warp::path::end())
        .and(warp::post())
        .and(pairing_secret_header())
        .and(warp::body::content_length_limit(MAX_SESSION_CONTROL_BYTES))
        .and(warp::body::json())
        .and(with_state(state.clone()))
        .map(
            |provided_secret: Option<String>, body: OperationRequest, state: SharedState| {
                if !pairing_secret_matches(provided_secret.as_deref()) {
                    return warp::reply::with_status(
                        warp::reply::json(
                            &serde_json::json!({"error": "Bridge authentication failed"}),
                        ),
                        warp::http::StatusCode::UNAUTHORIZED,
                    );
                }
                if !valid_context_id(&body.operation_id) {
                    return warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({"error": "Invalid operation ID"})),
                        warp::http::StatusCode::BAD_REQUEST,
                    );
                }

                let record = state
                    .lock()
                    .operation_records
                    .get(&body.operation_id)
                    .cloned();
                match record {
                    Some(record) => warp::reply::with_status(
                        warp::reply::json(&record),
                        warp::http::StatusCode::OK,
                    ),
                    None => warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({"error": "Operation not found"})),
                        warp::http::StatusCode::NOT_FOUND,
                    ),
                }
            },
        );

    // Let an explicitly disconnected Studio window release ownership immediately.
    let disconnect = bridge_namespace()
        .and(warp::path("disconnect"))
        .and(warp::path::end())
        .and(warp::post())
        .and(pairing_secret_header())
        .and(warp::body::content_length_limit(MAX_SESSION_CONTROL_BYTES))
        .and(warp::body::json())
        .and(with_state(state.clone()))
        .map(
            |provided_secret: Option<String>, body: SessionRequest, state: SharedState| {
                if !pairing_secret_matches(provided_secret.as_deref()) {
                    return warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({"error": "Plugin pairing failed"})),
                        warp::http::StatusCode::UNAUTHORIZED,
                    );
                }

                if !valid_session_id(&body.session_id) {
                    return warp::reply::with_status(
                        warp::reply::json(
                            &serde_json::json!({"error": "Invalid Studio session ID"}),
                        ),
                        warp::http::StatusCode::BAD_REQUEST,
                    );
                }

                let released = state.lock().release_session(&body.session_id);
                warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"released": released})),
                    warp::http::StatusCode::OK,
                )
            },
        );

    let routes = status
        .or(request)
        .or(poll)
        .or(respond)
        .or(cancel_operation)
        .or(operation_status)
        .or(disconnect)
        .with(cors());

    println!(
        "[bubbertron9001 Bridge] Starting on http://localhost:{}",
        BRIDGE_PORT
    );
    println!("[bubbertron9001 Bridge] Waiting for the Studio plugin to connect...");

    // Spawn cleanup task
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            cleanup_state.lock().cleanup_stale();
        }
    });

    // Spawn OAuth callback server
    tokio::spawn(async move {
        start_oauth_server().await;
    });

    // Never trust an existing listener: it may be an unrelated or malicious process.
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, BRIDGE_PORT));
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            warp::serve(routes)
                .run_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await;
        }
        Err(e) => {
            eprintln!(
                "[bubbertron9001 Bridge] Could not bind port {} ({}); refusing to trust the unknown listener",
                BRIDGE_PORT, e
            );
        }
    }
}

async fn handle_request(
    provided_secret: Option<String>,
    body: StudioRequest,
    state: SharedState,
) -> Result<impl warp::Reply, warp::Rejection> {
    if !pairing_secret_matches(provided_secret.as_deref()) {
        return Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Bridge authentication failed"})),
            warp::http::StatusCode::UNAUTHORIZED,
        ));
    }

    if body.path.is_empty()
        || !body.path.starts_with('/')
        || body.path.len() > MAX_REQUEST_PATH_BYTES
        || !valid_request_context(&body)
    {
        return Ok(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Invalid request path"})),
            warp::http::StatusCode::BAD_REQUEST,
        ));
    }

    let wait_timeout = request_timeout(&body.path);
    let (sender, receiver) = oneshot::channel();

    let id = {
        let mut state = state.lock();
        match state.enqueue(body, sender) {
            Ok(id) => id,
            Err(EnqueueError::QueueFull) => {
                return Ok(warp::reply::with_status(
                    warp::reply::json(
                        &serde_json::json!({"error": "Studio request queue is full"}),
                    ),
                    warp::http::StatusCode::TOO_MANY_REQUESTS,
                ));
            }
            Err(EnqueueError::DuplicateOperation) => {
                return Ok(warp::reply::with_status(
                    warp::reply::json(
                        &serde_json::json!({"error": "Duplicate Studio operation ID"}),
                    ),
                    warp::http::StatusCode::CONFLICT,
                ));
            }
        }
    };

    // Wait for response with timeout
    match tokio::time::timeout(wait_timeout, receiver).await {
        Ok(Ok(response)) => Ok(warp::reply::with_status(
            warp::reply::json(
                &serde_json::from_str::<serde_json::Value>(&response.body)
                    .unwrap_or(serde_json::json!({"raw": response.body})),
            ),
            warp::http::StatusCode::from_u16(response.status).unwrap_or(warp::http::StatusCode::OK),
        )),
        Ok(Err(_)) => {
            // Channel closed
            state.lock().fail_request(&id);
            Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({"error": "Request cancelled"})),
                warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            ))
        }
        Err(_) => {
            // Timeout
            state.lock().timeout_request(&id);
            Ok(warp::reply::with_status(
                warp::reply::json(
                    &serde_json::json!({"error": "Request timed out waiting for Studio response"}),
                ),
                warp::http::StatusCode::GATEWAY_TIMEOUT,
            ))
        }
    }
}

fn oauth_failure_html(_provider_error: &str) -> &'static str {
    r#"<!DOCTYPE html>
<html>
<head>
    <title>Authentication Failed</title>
    <style>
        body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #fafafa; }
        .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
        h1 { color: #ef4444; margin-bottom: 0.5rem; }
        p { color: #666; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Authentication Failed</h1>
        <p>Sign-in could not be completed.</p>
        <p>You can close this window and try again.</p>
    </div>
</body>
</html>"#
}

fn oauth_callback_reply(
    params: std::collections::HashMap<String, String>,
) -> warp::reply::Html<String> {
    let code = params.get("code").cloned().unwrap_or_default();
    let state = params.get("state").cloned().unwrap_or_default();

    if let Some(provider_error) = params.get("error") {
        // Never render the provider-controlled error query value as HTML.
        *OAUTH_CALLBACK_DATA.lock() = None;
        return warp::reply::html(oauth_failure_html(provider_error).to_string());
    }
    if !valid_oauth_callback(&code, &state) {
        *OAUTH_CALLBACK_DATA.lock() = None;
        return warp::reply::html(oauth_failure_html("invalid_callback").to_string());
    }

    *OAUTH_CALLBACK_DATA.lock() = Some(OAuthCallbackData {
        code,
        state,
        timestamp: chrono_lite_timestamp(),
    });

    let html = r#"<!DOCTYPE html>
<html>
<head>
    <title>Authentication Successful</title>
    <style>
        body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #fafafa; }
        .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
        h1 { color: #22c55e; margin-bottom: 0.5rem; }
        p { color: #666; }
        .checkmark { width: 56px; height: 56px; margin: 1rem auto; }
        .checkmark circle { fill: #22c55e; }
        .checkmark path { stroke: white; stroke-width: 3; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Authentication Successful!</h1>
        <svg class="checkmark" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="28"/>
            <path d="M16 28 L24 36 L40 20"/>
        </svg>
        <p>Sign-in complete.</p>
        <p>You can close this window now.</p>
    </div>
</body>
</html>"#;
    warp::reply::html(html.to_string())
}

fn oauth_poll_reply(provided_secret: Option<String>) -> warp::reply::WithStatus<warp::reply::Json> {
    if !pairing_secret_matches(provided_secret.as_deref()) {
        return warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Bridge authentication failed"})),
            warp::http::StatusCode::UNAUTHORIZED,
        );
    }

    let mut data = OAUTH_CALLBACK_DATA.lock();
    if data
        .as_ref()
        .is_some_and(|callback| !oauth_callback_is_fresh(callback, chrono_lite_timestamp()))
    {
        *data = None;
    }

    let body = if let Some(ref callback_data) = *data {
        serde_json::json!({
            "pending": true,
            "code": callback_data.code,
            "state": callback_data.state
        })
    } else {
        serde_json::json!({"pending": false})
    };
    warp::reply::with_status(warp::reply::json(&body), warp::http::StatusCode::OK)
}

fn oauth_clear_reply(
    provided_secret: Option<String>,
) -> warp::reply::WithStatus<warp::reply::Json> {
    if !pairing_secret_matches(provided_secret.as_deref()) {
        return warp::reply::with_status(
            warp::reply::json(&serde_json::json!({"error": "Bridge authentication failed"})),
            warp::http::StatusCode::UNAUTHORIZED,
        );
    }

    *OAUTH_CALLBACK_DATA.lock() = None;
    warp::reply::with_status(
        warp::reply::json(&serde_json::json!({"ok": true})),
        warp::http::StatusCode::OK,
    )
}

/// OAuth callback server for ChatGPT Plus/Pro authentication
async fn start_oauth_server() {
    // OAuth callback endpoint - stores auth code in memory for frontend to poll
    let callback = warp::path!("auth" / "callback")
        .and(warp::get())
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .map(oauth_callback_reply);

    // Poll endpoint - frontend polls this to get the OAuth callback data
    let poll = warp::path!("auth" / "poll")
        .and(warp::get())
        .and(pairing_secret_header())
        .map(oauth_poll_reply);

    // Clear endpoint - frontend calls this after successfully processing the callback
    let clear = warp::path!("auth" / "clear")
        .and(warp::post())
        .and(pairing_secret_header())
        .map(oauth_clear_reply);

    let oauth_routes = callback.or(poll).or(clear).with(cors());

    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, OAUTH_PORT));
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            println!(
                "[bubbertron9001 OAuth] Callback server on http://localhost:{}",
                OAUTH_PORT
            );
            warp::serve(oauth_routes)
                .run_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await;
        }
        Err(e) => {
            println!(
                "[bubbertron9001 OAuth] Port {} already in use ({})",
                OAUTH_PORT, e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use warp::Reply;

    lazy_static::lazy_static! {
        static ref OAUTH_TEST_LOCK: Mutex<()> = Mutex::new(());
    }

    fn studio_request(path: &str) -> StudioRequest {
        StudioRequest {
            path: path.to_string(),
            body: None,
            operation_id: None,
            run_id: None,
            owner_id: None,
            step_id: None,
            capability: None,
            target: None,
        }
    }

    #[test]
    fn a_request_is_leased_only_once() {
        let mut state = BridgeState::new();
        let (sender, _receiver) = oneshot::channel();
        let id = state
            .enqueue(studio_request("/ping"), sender)
            .expect("request should be queued");

        let first_lease = state
            .lease_next("session-a")
            .expect("request should be leased");
        assert_eq!(first_lease.0, id);
        assert!(state.lease_next("session-a").is_none());
        assert!(state.pending_requests.contains_key(&id));
    }

    #[test]
    fn pending_queue_is_bounded() {
        let mut state = BridgeState::new();
        let mut receivers = Vec::new();

        for _ in 0..MAX_PENDING_REQUESTS {
            let (sender, receiver) = oneshot::channel();
            receivers.push(receiver);
            assert!(state.enqueue(studio_request("/ping"), sender).is_ok());
        }

        let (sender, _receiver) = oneshot::channel();
        assert_eq!(
            state.enqueue(studio_request("/ping"), sender),
            Err(EnqueueError::QueueFull)
        );
        assert_eq!(state.pending_requests.len(), MAX_PENDING_REQUESTS);
    }

    #[test]
    fn second_studio_session_is_rejected_while_first_is_live() {
        let mut state = BridgeState::new();

        assert!(state.admit_session("session-a"));
        assert!(state.admit_session("session-a"));
        assert!(!state.admit_session("session-b"));
        assert!(!state.release_session("session-b"));
        assert!(state.release_session("session-a"));
        assert!(state.admit_session("session-b"));

        state
            .active_session
            .as_mut()
            .expect("session should be active")
            .last_seen = Instant::now() - Duration::from_secs(STUDIO_SESSION_TIMEOUT_SECS + 1);

        assert!(state.admit_session("session-c"));
    }

    #[test]
    fn only_the_session_that_leased_a_request_can_complete_it() {
        let mut state = BridgeState::new();
        let (sender, _receiver) = oneshot::channel();
        let id = state
            .enqueue(studio_request("/ping"), sender)
            .expect("request should be queued");
        state
            .lease_next("session-a")
            .expect("request should be leased");

        assert!(matches!(
            state.complete_request(&id, "session-b", 200),
            Err(CompleteRequestError::WrongSession)
        ));
        assert!(state.pending_requests.contains_key(&id));
        assert!(state.complete_request(&id, "session-a", 200).is_ok());
        assert!(!state.pending_requests.contains_key(&id));
    }

    #[test]
    fn unleased_operation_is_removed_when_cancelled() {
        let mut state = BridgeState::new();
        let (sender, _receiver) = oneshot::channel();
        let mut request = studio_request("/instance/create");
        request.operation_id = Some("op_cancel_before_lease".to_string());
        let id = state
            .enqueue(request, sender)
            .expect("request should be queued");

        let record = state.cancel_operation("op_cancel_before_lease");
        assert_eq!(record.status, OperationStatus::Cancelled);
        assert!(!record.may_complete);
        assert!(!state.pending_requests.contains_key(&id));
        assert!(state.lease_next("session-a").is_none());
    }

    #[test]
    fn leased_operation_records_completion_after_cancel() {
        let mut state = BridgeState::new();
        let (sender, _receiver) = oneshot::channel();
        let mut request = studio_request("/instance/create");
        request.operation_id = Some("op_cancel_after_lease".to_string());
        let id = state
            .enqueue(request, sender)
            .expect("request should be queued");
        state
            .lease_next("session-a")
            .expect("request should be leased");

        let cancelling = state.cancel_operation("op_cancel_after_lease");
        assert_eq!(cancelling.status, OperationStatus::CancelRequested);
        assert!(cancelling.may_complete);

        state
            .complete_request(&id, "session-a", 200)
            .expect("leased completion should still be accepted");
        let completed = state
            .operation_records
            .get("op_cancel_after_lease")
            .expect("operation history should remain");
        assert_eq!(completed.status, OperationStatus::Completed);
        assert!(completed.completed_after_cancel);
        assert!(!completed.may_complete);
    }

    #[test]
    fn timed_out_lease_keeps_a_bounded_late_response_window() {
        let mut state = BridgeState::new();
        let (sender, _receiver) = oneshot::channel();
        let mut request = studio_request("/game/install");
        request.operation_id = Some("op_install_timeout".to_string());
        let id = state
            .enqueue(request, sender)
            .expect("request should be queued");
        state
            .lease_next("session-a")
            .expect("request should be leased");

        state.timeout_request(&id);
        let timed_out = state
            .operation_records
            .get("op_install_timeout")
            .expect("operation should remain queryable");
        assert_eq!(timed_out.status, OperationStatus::CancelRequested);
        assert!(timed_out.may_complete);
        assert!(state.pending_requests.contains_key(&id));

        state
            .complete_request(&id, "session-a", 200)
            .expect("late leased completion should be recorded");
        let completed = state
            .operation_records
            .get("op_install_timeout")
            .expect("completion should remain in history");
        assert_eq!(completed.status, OperationStatus::Completed);
        assert!(completed.completed_after_cancel);
        assert!(!completed.may_complete);
    }

    #[test]
    fn curated_game_install_has_a_bounded_extended_timeout() {
        assert_eq!(
            request_timeout("/game/install"),
            Duration::from_secs(GAME_INSTALL_TIMEOUT_SECS)
        );
        assert_eq!(
            request_timeout("/instance/create"),
            Duration::from_secs(REQUEST_TIMEOUT_SECS)
        );
    }

    #[test]
    fn duplicate_client_operation_ids_are_rejected() {
        let mut state = BridgeState::new();
        let mut first = studio_request("/ping");
        first.operation_id = Some("op_same".to_string());
        let (first_sender, _first_receiver) = oneshot::channel();
        state
            .enqueue(first, first_sender)
            .expect("first operation should queue");

        let mut duplicate = studio_request("/ping");
        duplicate.operation_id = Some("op_same".to_string());
        let (duplicate_sender, _duplicate_receiver) = oneshot::channel();
        assert_eq!(
            state.enqueue(duplicate, duplicate_sender),
            Err(EnqueueError::DuplicateOperation)
        );
    }

    #[test]
    fn cancellation_tombstone_closes_the_enqueue_race() {
        let mut state = BridgeState::new();
        let record = state.cancel_operation("op_cancelled_early");
        assert_eq!(record.status, OperationStatus::Cancelled);

        let mut late_request = studio_request("/instance/create");
        late_request.operation_id = Some("op_cancelled_early".to_string());
        let (sender, _receiver) = oneshot::channel();
        assert_eq!(
            state.enqueue(late_request, sender),
            Err(EnqueueError::DuplicateOperation)
        );
    }

    #[test]
    fn operation_history_stays_bounded() {
        let mut state = BridgeState::new();
        for index in 0..(MAX_OPERATION_HISTORY + 20) {
            state.cancel_operation(&format!("op_history_{index}"));
        }

        assert_eq!(state.operation_records.len(), MAX_OPERATION_HISTORY);
        assert_eq!(state.operation_order.len(), MAX_OPERATION_HISTORY);
        assert!(!state.operation_records.contains_key("op_history_0"));
        assert!(state
            .operation_records
            .contains_key(&format!("op_history_{}", MAX_OPERATION_HISTORY + 19)));
    }

    #[test]
    fn studio_pairing_rejects_missing_or_wrong_secrets() {
        let expected = crate::plugin::pairing_secret();

        assert!(!pairing_secret_matches(None));
        assert!(!pairing_secret_matches(Some("wrong")));
        assert!(pairing_secret_matches(Some(expected)));
    }

    #[tokio::test]
    async fn desktop_status_and_request_reject_missing_or_wrong_auth() {
        let expected = crate::plugin::pairing_secret().to_string();
        let state: SharedState = Arc::new(Mutex::new(BridgeState::new()));

        for provided in [None, Some("wrong".to_string())] {
            let status = status_reply(provided.clone(), state.clone()).into_response();
            assert_eq!(status.status(), warp::http::StatusCode::UNAUTHORIZED);

            let request =
                handle_request(provided, studio_request("/instance/create"), state.clone())
                    .await
                    .expect("auth rejection should be a response")
                    .into_response();
            assert_eq!(request.status(), warp::http::StatusCode::UNAUTHORIZED);
        }

        let status = status_reply(Some(expected), state).into_response();
        assert_eq!(status.status(), warp::http::StatusCode::OK);
    }

    #[test]
    fn oauth_poll_and_clear_require_auth_while_callback_stays_public() {
        let _guard = OAUTH_TEST_LOCK.lock();
        let callback = OAuthCallbackData {
            code: "code".to_string(),
            state: "state".to_string(),
            timestamp: chrono_lite_timestamp(),
        };
        *OAUTH_CALLBACK_DATA.lock() = Some(callback);

        assert_eq!(
            oauth_poll_reply(None).into_response().status(),
            warp::http::StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            oauth_clear_reply(Some("wrong".to_string()))
                .into_response()
                .status(),
            warp::http::StatusCode::UNAUTHORIZED
        );
        assert!(OAUTH_CALLBACK_DATA.lock().is_some());

        let expected = crate::plugin::pairing_secret().to_string();
        assert_eq!(
            oauth_poll_reply(Some(expected.clone()))
                .into_response()
                .status(),
            warp::http::StatusCode::OK
        );
        assert_eq!(
            oauth_clear_reply(Some(expected)).into_response().status(),
            warp::http::StatusCode::OK
        );
        assert!(OAUTH_CALLBACK_DATA.lock().is_none());

        let public_callback = oauth_callback_reply(std::collections::HashMap::from([
            ("code".to_string(), "new-code".to_string()),
            ("state".to_string(), "new-state".to_string()),
        ]))
        .into_response();
        assert_eq!(public_callback.status(), warp::http::StatusCode::OK);
        *OAUTH_CALLBACK_DATA.lock() = None;
    }

    #[test]
    fn oauth_callback_expires_after_five_minutes() {
        let callback = OAuthCallbackData {
            code: "code".to_string(),
            state: "state".to_string(),
            timestamp: 1_000,
        };

        assert!(oauth_callback_is_fresh(
            &callback,
            callback.timestamp + OAUTH_CALLBACK_TTL_MS - 1
        ));
        assert!(!oauth_callback_is_fresh(
            &callback,
            callback.timestamp + OAUTH_CALLBACK_TTL_MS
        ));
    }

    #[test]
    fn oauth_callback_requires_bounded_code_and_state_values() {
        assert!(valid_oauth_callback("code", "state"));
        assert!(!valid_oauth_callback("", "state"));
        assert!(!valid_oauth_callback("code", ""));
        assert!(!valid_oauth_callback(
            &"c".repeat(MAX_OAUTH_CODE_BYTES + 1),
            "state"
        ));
        assert!(!valid_oauth_callback(
            "code",
            &"s".repeat(MAX_OAUTH_STATE_BYTES + 1)
        ));
    }

    #[test]
    fn oauth_failure_page_does_not_render_provider_error_html() {
        let attacker_controlled_error = "<script>alert('xss')</script>";
        let html = oauth_failure_html(attacker_controlled_error);

        assert!(!html.contains(attacker_controlled_error));
        assert!(html.contains("Sign-in could not be completed."));
    }

    #[tokio::test]
    async fn current_and_legacy_bridge_namespaces_are_available() {
        let route = bridge_namespace()
            .and(warp::path("status"))
            .and(warp::path::end())
            .map(warp::reply);

        for path in [
            "/bubbertron9001/status",
            "/bubberton9001/status",
            "/stud/status",
        ] {
            let response = warp::test::request().path(path).reply(&route).await;
            assert_eq!(response.status(), warp::http::StatusCode::OK);
        }
    }

    #[tokio::test]
    async fn cors_allows_local_app_and_rejects_remote_origins() {
        let route = warp::path::end()
            .and(warp::get())
            .map(warp::reply)
            .with(cors());

        let local = warp::test::request()
            .method("OPTIONS")
            .header("origin", "http://localhost:1430")
            .header("access-control-request-method", "GET")
            .reply(&route)
            .await;
        assert_eq!(local.status(), warp::http::StatusCode::OK);
        assert_eq!(
            local.headers()["access-control-allow-origin"],
            "http://localhost:1430"
        );

        let remote = warp::test::request()
            .method("OPTIONS")
            .header("origin", "https://example.com")
            .header("access-control-request-method", "GET")
            .reply(&route)
            .await;
        assert_eq!(remote.status(), warp::http::StatusCode::FORBIDDEN);
    }
}
