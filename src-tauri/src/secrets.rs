use keyring::v1::{Entry, Error as KeyringError};

const KEYRING_SERVICE: &str = "com.jakesixtyoneeighty.bubberton9001";
const ALLOWED_KEYS: [&str; 3] = ["openai-api-key", "anthropic-api-key", "codex-oauth"];
const MAX_SECRET_BYTES: usize = 64 * 1024;

fn validate_key(key: &str) -> Result<(), String> {
    if ALLOWED_KEYS.contains(&key) {
        Ok(())
    } else {
        Err("Unsupported secret key".to_string())
    }
}

fn keyring_entry(key: &str) -> Result<Entry, String> {
    validate_key(key)?;
    Entry::new(KEYRING_SERVICE, key)
        .map_err(|error| format!("Could not access the operating system credential store: {error}"))
}

/// Read one allowlisted credential from the operating system's native store.
///
/// The blocking platform API runs outside Tauri's async command executor.
#[tauri::command]
pub async fn secret_get(key: String) -> Result<Option<String>, String> {
    validate_key(&key)?;
    tauri::async_runtime::spawn_blocking(move || {
        let entry = keyring_entry(&key)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(format!(
                "Could not read from the operating system credential store: {error}"
            )),
        }
    })
    .await
    .map_err(|error| format!("Credential-store task failed: {error}"))?
}

/// Save one allowlisted credential to the operating system's native store.
#[tauri::command]
pub async fn secret_set(key: String, value: String) -> Result<(), String> {
    validate_key(&key)?;
    if value.is_empty() {
        return Err("Secret value cannot be empty".to_string());
    }
    if value.len() > MAX_SECRET_BYTES {
        return Err(format!(
            "Secret value exceeds the {MAX_SECRET_BYTES}-byte limit"
        ));
    }

    tauri::async_runtime::spawn_blocking(move || {
        keyring_entry(&key)?.set_password(&value).map_err(|error| {
            format!("Could not write to the operating system credential store: {error}")
        })
    })
    .await
    .map_err(|error| format!("Credential-store task failed: {error}"))?
}

/// Delete one allowlisted credential. Deleting a missing value is idempotent.
#[tauri::command]
pub async fn secret_delete(key: String) -> Result<(), String> {
    validate_key(&key)?;
    tauri::async_runtime::spawn_blocking(move || {
        let entry = keyring_entry(&key)?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(format!(
                "Could not delete from the operating system credential store: {error}"
            )),
        }
    })
    .await
    .map_err(|error| format!("Credential-store task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_expected_secret_names_are_allowed() {
        for key in ALLOWED_KEYS {
            assert!(validate_key(key).is_ok());
        }
        assert!(validate_key("arbitrary-user-controlled-key").is_err());
        assert!(validate_key("").is_err());
    }
}
