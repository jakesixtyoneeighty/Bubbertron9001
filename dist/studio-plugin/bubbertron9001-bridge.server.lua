--[[
		bubbertron9001 Bridge - Roblox Studio Plugin for bubbertron9001
	
		This plugin connects Roblox Studio to the bubbertron9001 desktop app,
	allowing AI-powered editing and manipulation of your game.
	
	Installation:
	1. In bubbertron9001 Desktop, choose Install Automatically or
	   Download Paired Plugin. Do not copy the raw repository template:
	   its pairing placeholder is intentionally unable to connect.
	2. If downloaded, move the paired file to your Roblox Plugins folder
	   - Windows: %LOCALAPPDATA%\Roblox\Plugins
	   - Mac: ~/Documents/Roblox/Plugins
	3. Restart Roblox Studio
	4. Enable HTTP requests in Game Settings > Security
	5. Click the bubbertron9001 button to connect
]]

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local TweenService = game:GetService("TweenService")
local RunService = game:GetService("RunService")
local LogService = game:GetService("LogService")

local PLUGIN_NAME = "bubbertron9001-bridge"
local PLUGIN_DISPLAY_NAME = "bubbertron9001"
local POLL_URL = "http://localhost:3001/bubbertron9001/poll"
local RESPOND_URL = "http://localhost:3001/bubbertron9001/respond"
local DISCONNECT_URL = "http://localhost:3001/bubbertron9001/disconnect"
local PAIRING_SECRET = "__bubbertron9001_PAIRING_SECRET__"
local SESSION_ID = HttpService:GenerateGUID(false)
local POLL_SESSION_URL = POLL_URL .. "?session_id=" .. HttpService:UrlEncode(SESSION_ID)
local MAX_ACTIVITY_LOG = 10
local MAX_COMPLETED_REQUESTS = 100
local MAX_TREE_RESULTS = 1000
local MAX_SEARCH_RESULTS = 200
local MAX_RUN_CODE_BYTES = 128 * 1024
local MAX_CAPTURED_OUTPUT_LINES = 200
local MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024
local MAX_IMPORTED_DESCENDANTS = 20000
local MAX_IMPORTED_SCRIPT_INVENTORY = 1000
local MAX_RECENT_LOG_ENTRIES = 200
local MAX_RECENT_LOG_REQUEST_LIMIT = 100
local MAX_RECENT_LOG_MESSAGE_BYTES = 4 * 1024
local MAX_RECENT_LOG_STORAGE_BYTES = 64 * 1024
local MAX_RECENT_LOG_RESPONSE_BYTES = 64 * 1024
local BRIDGE_LOG_PREFIXES = {
	"[bubbertron9001-bridge]",
	"[bubberton9001-bridge]",
}

-- State
local isConnected = false
local isConnecting = false
local hasSessionConflict = false
local hasPairingError = false
local hasHttpError = false
local pollingEnabled = false
local isProcessing = false
local projectInfo = nil
local activityLog = {}
local inFlightRequestIds = {}
local completedRequests = {}
local completedRequestOrder = {}
local recentLogs = {}
local recentLogBytes = 0
local recentLogSequence = 0
local recentLogsDropped = 0
local logMessageConnection = nil

-- UI Elements
local toolbar = plugin:CreateToolbar(PLUGIN_DISPLAY_NAME)
local toggleButton = toolbar:CreateButton(
	PLUGIN_DISPLAY_NAME,
	"Connect to bubbertron9001",
	"rbxassetid://4458901886" -- Generic connect icon
)

-- Forest Glass colors shared with the bubbertron9001 desktop app.
local Colors = {
	bg = Color3.fromRGB(18, 27, 18),
	bgSecondary = Color3.fromRGB(26, 40, 27),
	bgTertiary = Color3.fromRGB(42, 61, 43),
	accent = Color3.fromRGB(181, 201, 106),
	accentHover = Color3.fromRGB(205, 220, 132),
	onAccent = Color3.fromRGB(23, 36, 15),
	success = Color3.fromRGB(181, 201, 106),
	warning = Color3.fromRGB(226, 181, 79),
	error = Color3.fromRGB(179, 79, 79),
	onError = Color3.fromRGB(245, 237, 224),
	text = Color3.fromRGB(237, 230, 209),
	textSecondary = Color3.fromRGB(169, 185, 154),
	textMuted = Color3.fromRGB(110, 127, 104),
	border = Color3.fromRGB(67, 101, 63),
	processing = Color3.fromRGB(119, 153, 92),
}

-- Widget UI
local widget
local statusDot
local statusText
local subText
local connectButton
local activityContainer
local activityList
local processingIndicator

-- Utility: Create rounded frame
local function createFrame(props)
	local frame = Instance.new("Frame")
	frame.BackgroundColor3 = props.bg or Colors.bg
	frame.BorderSizePixel = 0
	frame.Size = props.size or UDim2.new(1, 0, 0, 40)
	frame.Position = props.position or UDim2.new(0, 0, 0, 0)
	frame.BackgroundTransparency = props.transparency or 0
	
	if props.corner then
		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, props.corner)
		corner.Parent = frame
	end
	
	if props.parent then
		frame.Parent = props.parent
	end
	
	return frame
end

-- Utility: Create text label
local function createLabel(props)
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = props.size or UDim2.new(1, 0, 0, 20)
	label.Position = props.position or UDim2.new(0, 0, 0, 0)
	label.TextColor3 = props.color or Colors.text
	label.Text = props.text or ""
	label.TextSize = props.textSize or 14
	label.Font = props.font or Enum.Font.GothamMedium
	label.TextXAlignment = props.align or Enum.TextXAlignment.Left
	label.TextTruncate = Enum.TextTruncate.AtEnd
	
	if props.parent then
		label.Parent = props.parent
	end
	
	return label
end

-- Utility: Create button
local function createButton(props)
	local button = Instance.new("TextButton")
	button.BackgroundColor3 = props.bg or Colors.accent
	button.BorderSizePixel = 0
	button.Size = props.size or UDim2.new(1, 0, 0, 36)
	button.Position = props.position or UDim2.new(0, 0, 0, 0)
	button.TextColor3 = props.textColor or Colors.onAccent
	button.Text = props.text or "Button"
	button.TextSize = props.textSize or 14
	button.Font = props.font or Enum.Font.GothamBold
	button.AutoButtonColor = false
	
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, props.corner or 12)
	corner.Parent = button
	
	-- Hover effect
	button.MouseEnter:Connect(function()
		TweenService:Create(button, TweenInfo.new(0.15), {
			BackgroundColor3 = props.bgHover or Colors.accentHover
		}):Play()
	end)
	
	button.MouseLeave:Connect(function()
		TweenService:Create(button, TweenInfo.new(0.15), {
			BackgroundColor3 = props.bg or Colors.accent
		}):Play()
	end)
	
	if props.parent then
		button.Parent = props.parent
	end
	
	return button
end

-- Add activity to log
local function addActivity(action, status, details)
	local entry = {
		time = os.date("%H:%M:%S"),
		action = action,
		status = status,
		details = details or ""
	}
	
	table.insert(activityLog, 1, entry)
	
	-- Keep log trimmed
	while #activityLog > MAX_ACTIVITY_LOG do
		table.remove(activityLog)
	end
	
	-- Update UI
	if activityList then
		-- Clear existing
		for _, child in ipairs(activityList:GetChildren()) do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		
		-- Add entries
		for i, entry in ipairs(activityLog) do
			local row = createFrame({
				bg = i % 2 == 0 and Colors.bgSecondary or Colors.bg,
				size = UDim2.new(1, 0, 0, 28),
				parent = activityList
			})
			
			-- Time
			createLabel({
				text = entry.time,
				color = Colors.textMuted,
				textSize = 11,
				font = Enum.Font.RobotoMono,
				size = UDim2.new(0, 55, 1, 0),
				position = UDim2.new(0, 8, 0, 0),
				parent = row
			})
			
			-- Status dot
			local dot = Instance.new("Frame")
			dot.Size = UDim2.new(0, 6, 0, 6)
			dot.Position = UDim2.new(0, 68, 0.5, -3)
			dot.BorderSizePixel = 0
			dot.BackgroundColor3 = entry.status == "success" and Colors.success or 
				entry.status == "error" and Colors.error or Colors.processing
			dot.Parent = row
			
			local dotCorner = Instance.new("UICorner")
			dotCorner.CornerRadius = UDim.new(1, 0)
			dotCorner.Parent = dot
			
			-- Action
			createLabel({
				text = entry.action,
				color = Colors.textSecondary,
				textSize = 11,
				font = Enum.Font.Gotham,
				size = UDim2.new(1, -90, 1, 0),
				position = UDim2.new(0, 82, 0, 0),
				parent = row
			})
		end
	end
end

local function createWidget()
	local info = DockWidgetPluginGuiInfo.new(
		Enum.InitialDockState.Float,
		true,  -- Initially enabled
		false, -- Override previous state
		280,   -- Width
		320,   -- Height
		260,   -- Min width
		280    -- Min height
	)
	
	widget = plugin:CreateDockWidgetPluginGui("bubbertron9001Bridge", info)
	widget.Title = "bubbertron9001"
	widget.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	
	-- Main container
	local container = createFrame({
		bg = Colors.bg,
		size = UDim2.new(1, 0, 1, 0),
	})
	container.Name = "Container"
	container.Parent = widget
	
	-- Padding
	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 16)
	padding.PaddingBottom = UDim.new(0, 16)
	padding.PaddingLeft = UDim.new(0, 16)
	padding.PaddingRight = UDim.new(0, 16)
	padding.Parent = container
	
	-- Layout
	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 12)
	layout.Parent = container
	
	-- ========== Status Card ==========
	local statusCard = createFrame({
		bg = Colors.bgSecondary,
		size = UDim2.new(1, 0, 0, 80),
		corner = 16,
		parent = container
	})
	statusCard.LayoutOrder = 1
	
	local statusPadding = Instance.new("UIPadding")
	statusPadding.PaddingTop = UDim.new(0, 14)
	statusPadding.PaddingBottom = UDim.new(0, 14)
	statusPadding.PaddingLeft = UDim.new(0, 14)
	statusPadding.PaddingRight = UDim.new(0, 14)
	statusPadding.Parent = statusCard
	
	-- Status header row
	local statusHeader = Instance.new("Frame")
	statusHeader.Size = UDim2.new(1, 0, 0, 24)
	statusHeader.BackgroundTransparency = 1
	statusHeader.Parent = statusCard
	
	-- Status dot (animated)
	statusDot = Instance.new("Frame")
	statusDot.Name = "Dot"
	statusDot.Size = UDim2.new(0, 10, 0, 10)
	statusDot.Position = UDim2.new(0, 0, 0.5, -5)
	statusDot.BackgroundColor3 = Colors.error
	statusDot.BorderSizePixel = 0
	statusDot.Parent = statusHeader
	
	local dotCorner = Instance.new("UICorner")
	dotCorner.CornerRadius = UDim.new(1, 0)
	dotCorner.Parent = statusDot
	
	-- Glow effect for dot
	local dotGlow = Instance.new("UIStroke")
	dotGlow.Color = Colors.error
	dotGlow.Thickness = 2
	dotGlow.Transparency = 0.7
	dotGlow.Parent = statusDot
	
	-- Status text
	statusText = createLabel({
		text = "Disconnected",
		color = Colors.text,
		textSize = 16,
		font = Enum.Font.GothamBold,
		size = UDim2.new(1, -20, 1, 0),
		position = UDim2.new(0, 18, 0, 0),
		parent = statusHeader
	})
	
	-- Processing indicator (animated spinner text)
	processingIndicator = createLabel({
		text = "",
		color = Colors.processing,
		textSize = 12,
		font = Enum.Font.GothamMedium,
		size = UDim2.new(1, 0, 0, 16),
		position = UDim2.new(0, 0, 0, 28),
		parent = statusCard
	})
	
	-- Sub text / Project info
	subText = createLabel({
		text = "Click Connect to start",
		color = Colors.textSecondary,
		textSize = 12,
		font = Enum.Font.Gotham,
		size = UDim2.new(1, 0, 0, 16),
		position = UDim2.new(0, 0, 1, -16),
		parent = statusCard
	})
	
	-- ========== Connect Button ==========
	connectButton = createButton({
		text = "Connect",
		size = UDim2.new(1, 0, 0, 44),
		corner = 14,
		parent = container
	})
	connectButton.LayoutOrder = 2
	
	connectButton.MouseButton1Click:Connect(function()
		toggleConnection()
	end)
	
	-- ========== Activity Log ==========
	local activityHeader = createLabel({
		text = "Recent Activity",
		color = Colors.textMuted,
		textSize = 11,
		font = Enum.Font.GothamBold,
		size = UDim2.new(1, 0, 0, 16),
		parent = container
	})
	activityHeader.LayoutOrder = 3
	
	activityContainer = createFrame({
		bg = Colors.bgSecondary,
		size = UDim2.new(1, 0, 1, -180),
		corner = 14,
		parent = container
	})
	activityContainer.LayoutOrder = 4
	activityContainer.ClipsDescendants = true
	
	-- Scrolling frame for activity
	local scrollFrame = Instance.new("ScrollingFrame")
	scrollFrame.Size = UDim2.new(1, 0, 1, 0)
	scrollFrame.BackgroundTransparency = 1
	scrollFrame.BorderSizePixel = 0
	scrollFrame.ScrollBarThickness = 4
	scrollFrame.ScrollBarImageColor3 = Colors.border
	scrollFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
	scrollFrame.AutomaticCanvasSize = Enum.AutomaticSize.Y
	scrollFrame.Parent = activityContainer
	
	activityList = Instance.new("Frame")
	activityList.Size = UDim2.new(1, 0, 0, 0)
	activityList.BackgroundTransparency = 1
	activityList.AutomaticSize = Enum.AutomaticSize.Y
	activityList.Parent = scrollFrame
	
	local activityLayout = Instance.new("UIListLayout")
	activityLayout.SortOrder = Enum.SortOrder.LayoutOrder
	activityLayout.Parent = activityList
	
	-- Empty state
	local emptyLabel = createLabel({
		text = "No activity yet",
		color = Colors.textMuted,
		textSize = 12,
		font = Enum.Font.Gotham,
		size = UDim2.new(1, 0, 0, 40),
		align = Enum.TextXAlignment.Center,
		parent = activityList
	})
	emptyLabel.Name = "EmptyState"
	emptyLabel.TextYAlignment = Enum.TextYAlignment.Center
	
	return widget
end

-- Animate processing indicator
local processingDots = 0
local function updateProcessingAnimation()
	if isProcessing and processingIndicator then
		processingDots = (processingDots % 3) + 1
		processingIndicator.Text = "Processing" .. string.rep(".", processingDots)
	elseif processingIndicator then
		processingIndicator.Text = ""
	end
end

-- Start processing animation loop
task.spawn(function()
	while true do
		updateProcessingAnimation()
		task.wait(0.4)
	end
end)

-- Animate status dot glow
local function animateDotGlow()
	if not statusDot then return end
	
	local glow = statusDot:FindFirstChildOfClass("UIStroke")
	if not glow then return end
	
	-- Pulse animation
	while true do
		if isConnected or isConnecting then
			TweenService:Create(glow, TweenInfo.new(1, Enum.EasingStyle.Sine), {
				Transparency = 0.3
			}):Play()
			task.wait(1)
			TweenService:Create(glow, TweenInfo.new(1, Enum.EasingStyle.Sine), {
				Transparency = 0.8
			}):Play()
			task.wait(1)
		else
			glow.Transparency = 0.7
			task.wait(0.5)
		end
	end
end

task.spawn(animateDotGlow)

local function updateUI()
	if not statusDot or not statusText or not subText or not connectButton then
		return
	end
	
	local glow = statusDot:FindFirstChildOfClass("UIStroke")
	
	if isProcessing then
		statusDot.BackgroundColor3 = Colors.processing
		if glow then glow.Color = Colors.processing end
		statusText.Text = "Processing..."
		subText.Text = "Executing AI command"
		connectButton.Text = "Disconnect"
		connectButton.BackgroundColor3 = Colors.error
		connectButton.TextColor3 = Colors.onError
	elseif hasPairingError then
		statusDot.BackgroundColor3 = Colors.error
		if glow then glow.Color = Colors.error end
		statusText.Text = "Plugin update required"
		subText.Text = "Reinstall the plugin from bubbertron9001"
		connectButton.Text = "Cancel"
		connectButton.BackgroundColor3 = Colors.textMuted
		connectButton.TextColor3 = Colors.text
	elseif hasHttpError then
		statusDot.BackgroundColor3 = Colors.warning
		if glow then glow.Color = Colors.warning end
		statusText.Text = "One setting to allow"
		subText.Text = "Allow HTTP Requests in Experience Settings"
		connectButton.Text = "Cancel"
		connectButton.BackgroundColor3 = Colors.textMuted
		connectButton.TextColor3 = Colors.text
	elseif hasSessionConflict then
		statusDot.BackgroundColor3 = Colors.warning
		if glow then glow.Color = Colors.warning end
		statusText.Text = "Another Studio is connected"
		subText.Text = "Waiting for that window to disconnect"
		connectButton.Text = "Cancel"
		connectButton.BackgroundColor3 = Colors.textMuted
		connectButton.TextColor3 = Colors.text
	elseif isConnecting then
		statusDot.BackgroundColor3 = Colors.warning
		if glow then glow.Color = Colors.warning end
		statusText.Text = "Connecting..."
		subText.Text = "Looking for bubbertron9001 Desktop"
		connectButton.Text = "Cancel"
		connectButton.BackgroundColor3 = Colors.textMuted
		connectButton.TextColor3 = Colors.text
	elseif isConnected then
		statusDot.BackgroundColor3 = Colors.success
		if glow then glow.Color = Colors.success end
		statusText.Text = "Connected"
		subText.Text = projectInfo and ("Project: " .. projectInfo) or "Ready for AI commands"
		connectButton.Text = "Disconnect"
		connectButton.BackgroundColor3 = Colors.error
		connectButton.TextColor3 = Colors.onError
	else
		statusDot.BackgroundColor3 = Colors.error
		if glow then glow.Color = Colors.error end
		statusText.Text = "Disconnected"
		subText.Text = "Click Connect to start"
		connectButton.Text = "Connect"
		connectButton.BackgroundColor3 = Colors.accent
		connectButton.TextColor3 = Colors.onAccent
	end
	
	toggleButton:SetActive(
		isConnected
			or isConnecting
			or hasSessionConflict
			or hasPairingError
			or hasHttpError
	)
end

-- Utility functions
local function jsonEncode(data)
	return HttpService:JSONEncode(data)
end

local function jsonDecode(str)
	return HttpService:JSONDecode(str)
end

local function isHttpRequestsDisabledError(value)
	local message = string.lower(tostring(value or ""))
	local mentionsHttp =
		string.find(message, "http requests", 1, true) ~= nil
		or string.find(message, "httpservice", 1, true) ~= nil
	local mentionsPermission =
		string.find(message, "not enabled", 1, true) ~= nil
		or string.find(message, "disabled", 1, true) ~= nil
		or string.find(message, "allow http", 1, true) ~= nil
	return mentionsHttp and mentionsPermission
end

local function getHttpFailureDetails(requestSucceeded, response)
	if not requestSucceeded then
		return response
	end
	if type(response) == "table" then
		return response.StatusMessage or response.Body or ""
	end
	return response
end

local LOG_LEVEL_BY_MESSAGE_TYPE = {
	[Enum.MessageType.MessageOutput] = "output",
	[Enum.MessageType.MessageInfo] = "info",
	[Enum.MessageType.MessageWarning] = "warning",
	[Enum.MessageType.MessageError] = "error",
}

local function redactSensitiveLogText(message)
	local redacted = string.gsub(
		message,
		"([Aa]uthorization:%s*[Bb]earer%s+)[^%s,;]+",
		"%1[redacted]"
	)
	redacted = string.gsub(redacted, "sk%-[%w_%-]+", "sk-[redacted]")
	redacted = string.gsub(
		redacted,
		"([Aa][Pp][Ii][_%-%s]?[Kk][Ee][Yy]%s*[:=]%s*)[^%s,;]+",
		"%1[redacted]"
	)
	redacted = string.gsub(
		redacted,
		"([Pp]airing[_%-%s]?[Ss]ecret%s*[:=]%s*)[^%s,;]+",
		"%1[redacted]"
	)
	redacted = string.gsub(
		redacted,
		"([%.]ROBLOSECURITY%s*[:=]%s*)[^%s,;]+",
		"%1[redacted]"
	)
	return redacted
end

local function truncateUtf8Bytes(value, maxBytes)
	if #value <= maxBytes then
		return value, false
	end

	local endIndex = maxBytes
	local validBoundary, boundary = pcall(utf8.offset, value, 0, maxBytes + 1)
	if validBoundary and boundary then
		endIndex = boundary - 1
	end
	return string.sub(value, 1, endIndex), true
end

local function appendRecentLog(message, messageType, timestamp)
	if type(message) ~= "string" then
		return
	end
	for _, prefix in ipairs(BRIDGE_LOG_PREFIXES) do
		if string.sub(message, 1, #prefix) == prefix then
			return
		end
	end

	local level = LOG_LEVEL_BY_MESSAGE_TYPE[messageType]
	if not level then
		return
	end

	local safeMessage = redactSensitiveLogText(message)
	local boundedMessage, messageTruncated =
		truncateUtf8Bytes(safeMessage, MAX_RECENT_LOG_MESSAGE_BYTES)
	local capturedAt = timestamp
	if type(capturedAt) ~= "number"
		or capturedAt ~= capturedAt
		or capturedAt == math.huge
		or capturedAt == -math.huge
	then
		capturedAt = os.time()
	end

	recentLogSequence = recentLogSequence + 1
	local entry = {
		sequence = recentLogSequence,
		timestamp = capturedAt,
		level = level,
		message = boundedMessage,
		truncated = messageTruncated,
	}
	table.insert(recentLogs, entry)
	recentLogBytes = recentLogBytes + #boundedMessage

	while #recentLogs > MAX_RECENT_LOG_ENTRIES
		or recentLogBytes > MAX_RECENT_LOG_STORAGE_BYTES
	do
		local removed = table.remove(recentLogs, 1)
		if removed then
			recentLogBytes = math.max(0, recentLogBytes - #removed.message)
			recentLogsDropped = recentLogsDropped + 1
		end
	end
end

local function seedRecentLogs()
	local success, history = pcall(function()
		return LogService:GetLogHistory()
	end)
	if not success or type(history) ~= "table" then
		return
	end

	for _, entry in ipairs(history) do
		if type(entry) == "table" then
			appendRecentLog(entry.message, entry.messageType, entry.timestamp)
		end
	end
end

seedRecentLogs()
logMessageConnection = LogService.MessageOut:Connect(function(message, messageType)
	appendRecentLog(message, messageType, os.time())
end)

local function validateAddressableName(name)
	if type(name) ~= "string" or name == "" then
		return false, "Instance names must be non-empty strings"
	end
	if string.find(name, ".", 1, true) then
		return false, "Instance names containing '.' are not addressable by this bridge"
	end
	return true
end

local function assertAddressableName(name)
	local valid, nameError = validateAddressableName(name)
	if not valid then
		error(nameError, 2)
	end
end

local function assertUniqueChildName(parent, name, ignoredInstance)
	for _, child in ipairs(parent:GetChildren()) do
		if child ~= ignoredInstance and child.Name == name then
			error("A child named '" .. name .. "' already exists under " .. parent:GetFullName(), 2)
		end
	end
end

local function getInstanceFromPath(path)
	if type(path) ~= "string" or path == "" then
		return nil, "Path must be a non-empty string"
	end

	local parts = string.split(path, ".")
	if parts[1] ~= "game" then
		return nil, "Path must start with 'game'"
	end
	if #parts == 1 then
		return game
	end
		
	local current = game
	for i = 2, #parts do
		local segment = parts[i]
		if segment == "" then
			return nil, "Path contains an empty segment"
		end

		local remainingPath = table.concat(parts, ".", i)
		local matches = {}
		for _, child in ipairs(current:GetChildren()) do
			if string.find(child.Name, ".", 1, true) then
				if remainingPath == child.Name or string.sub(remainingPath, 1, #child.Name + 1) == child.Name .. "." then
					return nil, "Path is ambiguous because '" .. child.Name .. "' contains '.'"
				end
			end
			if child.Name == segment then
				table.insert(matches, child)
			end
		end

		if #matches == 0 then
			return nil, "No child named '" .. segment .. "' under " .. current:GetFullName()
		end
		if #matches > 1 then
			return nil, "Ambiguous path: multiple children named '" .. segment .. "' under " .. current:GetFullName()
		end
		current = matches[1]
	end
		
	return current
end

local function requireInstanceFromPath(path, label)
	local instance, pathError = getInstanceFromPath(path)
	if not instance then
		error((label or "Instance") .. " path error: " .. pathError, 2)
	end
	return instance
end

local function getInstancePath(instance)
	local target = instance
	local parts = {}
	local current = instance
	while current and current ~= game do
		assertAddressableName(current.Name)
		if not current.Parent then
			error("Instance is not a descendant of game")
		end
		assertUniqueChildName(current.Parent, current.Name, current)
		table.insert(parts, 1, current.Name)
		current = current.Parent
	end
	if current ~= game then
		error("Instance is not a descendant of game")
	end
	if #parts == 0 then
		return "game"
	end
	local path = "game." .. table.concat(parts, ".")
	local resolved, pathError = getInstanceFromPath(path)
	if resolved ~= target then
		error("Instance path is not uniquely addressable: " .. (pathError or path))
	end
	return path
end

local function instanceToInfo(instance, includeChildren)
	local info = {
		path = getInstancePath(instance),
		name = instance.Name,
		className = instance.ClassName,
	}
	
	if includeChildren then
		info.children = {}
		for _, child in ipairs(instance:GetChildren()) do
			table.insert(info.children, instanceToInfo(child, false))
		end
	end
	
	return info
end

-- Request handlers
local handlers = {}

handlers["/ping"] = function()
	return { status = "ok", plugin = PLUGIN_NAME }
end

handlers["/playtest/state"] = function()
	local runState = RunService.RunState.Name
	local isEdit = RunService:IsEdit()
	local state
	if isEdit then
		state = "editing"
	elseif runState == "Running" then
		state = "running"
	elseif runState == "Paused" then
		state = "paused"
	else
		state = string.lower(runState)
	end

	return {
		state = state,
		runState = runState,
		isRunning = RunService:IsRunning(),
		isEdit = isEdit,
		isRunMode = RunService:IsRunMode(),
		isClient = RunService:IsClient(),
		isServer = RunService:IsServer(),
		isStudio = RunService:IsStudio(),
		observedAt = os.time(),
	}
end

local VALID_LOG_LEVELS = {
	output = true,
	info = true,
	warning = true,
	error = true,
}

local function parseRequestedLogLevels(levels)
	if levels == nil then
		return nil
	end
	if type(levels) ~= "table" then
		error("levels must be an array")
	end

	local itemCount = 0
	for key in pairs(levels) do
		if type(key) ~= "number" or key % 1 ~= 0 or key < 1 then
			error("levels must be a dense array")
		end
		itemCount = itemCount + 1
	end
	if itemCount < 1 or itemCount > 4 then
		error("levels must contain between 1 and 4 values")
	end

	local requested = {}
	for index = 1, itemCount do
		local level = levels[index]
		if type(level) ~= "string" or not VALID_LOG_LEVELS[level] then
			error("invalid log level at index " .. index)
		end
		if requested[level] then
			error("duplicate log level: " .. level)
		end
		requested[level] = true
	end
	return requested
end

local function countTruncatedMessages(logs)
	local count = 0
	for _, entry in ipairs(logs) do
		if entry.truncated then
			count = count + 1
		end
	end
	return count
end

handlers["/playtest/logs"] = function(data)
	local limit = data.limit or 50
	if type(limit) ~= "number"
		or limit % 1 ~= 0
		or limit < 1
		or limit > MAX_RECENT_LOG_REQUEST_LIMIT
	then
		error(
			"limit must be an integer from 1 to "
				.. MAX_RECENT_LOG_REQUEST_LIMIT
		)
	end
	local requestedLevels = parseRequestedLogLevels(data.levels)

	local logs = {}
	local matchingAvailable = 0
	for index = #recentLogs, 1, -1 do
		local entry = recentLogs[index]
		if not requestedLevels or requestedLevels[entry.level] then
			matchingAvailable = matchingAvailable + 1
			if #logs < limit then
				table.insert(logs, 1, entry)
			end
		end
	end

	local response = {
		logs = logs,
		count = #logs,
		available = matchingAvailable,
		stored = #recentLogs,
		dropped = recentLogsDropped,
		hasMore = matchingAvailable > #logs,
		messageTruncations = countTruncatedMessages(logs),
		payloadTruncated = false,
		bridgeMessagesExcluded = true,
		diagnosticOnly = true,
	}

	local encoded = jsonEncode(response)
	while #encoded > MAX_RECENT_LOG_RESPONSE_BYTES and #logs > 0 do
		table.remove(logs, 1)
		response.count = #logs
		response.hasMore = true
		response.messageTruncations = countTruncatedMessages(logs)
		response.payloadTruncated = true
		encoded = jsonEncode(response)
	end
	if #encoded > MAX_RECENT_LOG_RESPONSE_BYTES then
		error("recent log response exceeds its safety limit")
	end

	return response
end

handlers["/script/get"] = function(data)
	local instance = requireInstanceFromPath(data.path, "Script")
	
	if not instance:IsA("LuaSourceContainer") then
		error("Not a script: " .. data.path)
	end
	
	local source = ScriptEditorService:GetEditorSource(instance)
	if not source then
		source = instance.Source
	end
	
	return {
		path = getInstancePath(instance),
		source = source,
		className = instance.ClassName,
	}
end

handlers["/script/set"] = function(data)
	local instance = requireInstanceFromPath(data.path, "Script")
	
	if not instance:IsA("LuaSourceContainer") then
		error("Not a script: " .. data.path)
	end
	
	ScriptEditorService:UpdateSourceAsync(instance, function()
		return data.source
	end)
	
	return { path = getInstancePath(instance) }
end

handlers["/script/edit"] = function(data)
	local instance = requireInstanceFromPath(data.path, "Script")
	
	if not instance:IsA("LuaSourceContainer") then
		error("Not a script: " .. data.path)
	end

	if type(data.oldCode) ~= "string" or data.oldCode == "" then
		error("oldCode must be a non-empty string")
	end
	if type(data.newCode) ~= "string" then
		error("newCode must be a string")
	end

	local replaced = 0
	ScriptEditorService:UpdateSourceAsync(instance, function(currentSource)
		local startIndex, endIndex = string.find(currentSource, data.oldCode, 1, true)
		if not startIndex then
			error("Code not found in script")
		end

		local nextMatch = string.find(currentSource, data.oldCode, startIndex + 1, true)
		if nextMatch then
			error("Code appears more than once; provide a unique oldCode value")
		end

		replaced = 1
		return string.sub(currentSource, 1, startIndex - 1)
			.. data.newCode
			.. string.sub(currentSource, endIndex + 1)
	end)

	return { path = getInstancePath(instance), replaced = replaced }
end

handlers["/instance/children"] = function(data)
	local instance = requireInstanceFromPath(data.path)
	local instances = data.recursive and instance:GetDescendants() or instance:GetChildren()
	local limit = data.limit or MAX_TREE_RESULTS
	if type(limit) ~= "number" or limit % 1 ~= 0 or limit < 1 or limit > MAX_TREE_RESULTS then
		error("limit must be an integer from 1 to " .. MAX_TREE_RESULTS)
	end
	if #instances > limit then
		error(
			"Inspection matched "
				.. #instances
				.. " instances, exceeding the "
				.. limit
				.. "-instance limit; inspect a narrower path"
		)
	end

	local children = {}
	for _, child in ipairs(instances) do
		table.insert(children, instanceToInfo(child, false))
	end

	return children
end

handlers["/instance/properties"] = function(data)
	local instance = requireInstanceFromPath(data.path)
	
	local props = {}
	local commonProps = {"Name", "ClassName", "Parent"}
	
	if instance:IsA("BasePart") then
		local partProps = {"Position", "Size", "CFrame", "Anchored", "CanCollide", "Transparency", "BrickColor", "Material"}
		for _, p in ipairs(partProps) do
			table.insert(commonProps, p)
		end
	end
	
	if instance:IsA("GuiObject") then
		local guiProps = {"Position", "Size", "Visible", "BackgroundColor3", "BackgroundTransparency"}
		for _, p in ipairs(guiProps) do
			table.insert(commonProps, p)
		end
	end
	
	for _, propName in ipairs(commonProps) do
		local success, value = pcall(function()
			return instance[propName]
		end)
		if success then
			table.insert(props, {
				name = propName,
				value = tostring(value),
				type = typeof(value),
			})
		end
	end
	
	return props
end

handlers["/instance/set"] = function(data)
	local instance = requireInstanceFromPath(data.path)
		
	local value = data.value
	if data.property == "Name" then
		if instance == game then
			error("The game root cannot be renamed")
		end
		assertAddressableName(value)
		assertUniqueChildName(instance.Parent, value, instance)
		instance.Name = value
		return { path = getInstancePath(instance) }
	end
		
	if value == "true" then
		value = true
	elseif value == "false" then
		value = false
	elseif tonumber(value) then
		value = tonumber(value)
	elseif string.match(value, "^%d+,%s*%d+,%s*%d+$") then
		local parts = string.split(value, ",")
		local a, b, c = tonumber(parts[1]), tonumber(parts[2]), tonumber(parts[3])
		if a and b and c then
			if a <= 255 and b <= 255 and c <= 255 and string.find(data.property, "Color") then
				value = Color3.fromRGB(a, b, c)
			else
				value = Vector3.new(a, b, c)
			end
		end
	elseif string.match(value, "^#%x%x%x%x%x%x$") then
		local r = tonumber(string.sub(value, 2, 3), 16)
		local g = tonumber(string.sub(value, 4, 5), 16)
		local b = tonumber(string.sub(value, 6, 7), 16)
		value = Color3.fromRGB(r, g, b)
	elseif string.match(value, "^Enum%.") then
		local parts = string.split(value, ".")
		if #parts == 3 then
			local enumType = Enum[parts[2]]
			if enumType then
				value = enumType[parts[3]]
			end
		end
	end
	
	instance[data.property] = value
	
	return { path = getInstancePath(instance) }
end

handlers["/instance/create"] = function(data)
	local parent = requireInstanceFromPath(data.parent, "Parent")
		
	local instance = Instance.new(data.className)
	if data.name then
		instance.Name = data.name
	end
	assertAddressableName(instance.Name)
	assertUniqueChildName(parent, instance.Name)
	instance.Parent = parent
	
	return { path = getInstancePath(instance) }
end

handlers["/instance/delete"] = function(data)
	local instance = requireInstanceFromPath(data.path)
	
	local path = getInstancePath(instance)
	instance:Destroy()
	
	return { deleted = path }
end

handlers["/instance/clone"] = function(data)
	local instance = requireInstanceFromPath(data.path)
	local parent
	if data.parent then
		parent = requireInstanceFromPath(data.parent, "Parent")
	else
		parent = instance.Parent
	end
	assertUniqueChildName(parent, instance.Name)

	local clone = instance:Clone()
	clone.Parent = parent
	
	return { path = getInstancePath(clone) }
end

handlers["/instance/move"] = function(data)
	local instance = requireInstanceFromPath(data.path)
		
	local newParent = requireInstanceFromPath(data.newParent, "Parent")
	assertUniqueChildName(newParent, instance.Name, instance)
		
	instance.Parent = newParent
	
	return { path = getInstancePath(instance) }
end

handlers["/instance/bulk-create"] = function(data)
	local created = {}
	local errors = {}
		
	for _, item in ipairs(data.instances) do
		local success, result = pcall(function()
			local parent = requireInstanceFromPath(item.parent, "Parent")
			local instance = Instance.new(item.className)
			if item.name then
				instance.Name = item.name
			end
			assertAddressableName(instance.Name)
			assertUniqueChildName(parent, instance.Name)
			instance.Parent = parent
			return getInstancePath(instance)
		end)
		if success then
			table.insert(created, result)
		else
			table.insert(errors, tostring(result))
		end
	end
		
	return { created = created, errors = errors }
end

handlers["/instance/bulk-delete"] = function(data)
	local deleted = {}
	local errors = {}
		
	for _, path in ipairs(data.paths) do
		local instance, pathError = getInstanceFromPath(path)
		if instance then
			local fullPath = getInstancePath(instance)
			instance:Destroy()
			table.insert(deleted, fullPath)
		else
			table.insert(errors, path .. ": " .. pathError)
		end
	end
		
	return { deleted = deleted, errors = errors }
end

handlers["/instance/bulk-set"] = function(data)
	local updated = 0
	local errors = {}
	
	for _, op in ipairs(data.operations) do
		local instance, pathError = getInstanceFromPath(op.path)
		if not instance then
			table.insert(errors, op.path .. ": " .. pathError)
		else
			local success, err = pcall(function()
				local value = op.value
				if op.property == "Name" then
					if instance == game then
						error("The game root cannot be renamed")
					end
					assertAddressableName(value)
					assertUniqueChildName(instance.Parent, value, instance)
					instance.Name = value
					return
				end

				-- Parse value based on type
				if value == "true" then
					value = true
				elseif value == "false" then
					value = false
				elseif tonumber(value) then
					value = tonumber(value)
				elseif string.match(value, "^%d+,%s*%d+,%s*%d+$") then
					local parts = string.split(value, ",")
					local a, b, c = tonumber(parts[1]), tonumber(parts[2]), tonumber(parts[3])
					if a and b and c then
						if a <= 255 and b <= 255 and c <= 255 and string.find(op.property, "Color") then
							value = Color3.fromRGB(a, b, c)
						else
							value = Vector3.new(a, b, c)
						end
					end
				elseif string.match(value, "^#%x%x%x%x%x%x$") then
					local r = tonumber(string.sub(value, 2, 3), 16)
					local g = tonumber(string.sub(value, 4, 5), 16)
					local b = tonumber(string.sub(value, 6, 7), 16)
					value = Color3.fromRGB(r, g, b)
				elseif string.match(value, "^Enum%.") then
					local parts = string.split(value, ".")
					if #parts == 3 then
						local enumType = Enum[parts[2]]
						if enumType then
							value = enumType[parts[3]]
						end
					end
				end
				
				instance[op.property] = value
			end)
			
			if success then
				updated = updated + 1
			else
				table.insert(errors, op.path .. "." .. op.property .. ": " .. tostring(err))
			end
		end
	end
	
	return { updated = updated, errors = errors }
end

handlers["/instance/search"] = function(data)
	local root = requireInstanceFromPath(data.root or "game", "Root")
	
	local results = {}
	local limit = data.limit or 50
	if type(limit) ~= "number" or limit % 1 ~= 0 or limit < 1 or limit > MAX_SEARCH_RESULTS then
		error("limit must be an integer from 1 to " .. MAX_SEARCH_RESULTS)
	end
	
	for _, instance in ipairs(root:GetDescendants()) do
		if #results >= limit then
			break
		end
		
		local matches = true
		
		if data.name then
			matches = matches and string.lower(instance.Name):find(string.lower(data.name), 1, true) ~= nil
		end
		
		if data.className then
			matches = matches and instance.ClassName == data.className
		end
		
		if matches then
			table.insert(results, instanceToInfo(instance, false))
		end
	end
	
	return results
end

handlers["/selection/get"] = function()
	local selected = Selection:Get()
	local results = {}
	
	for _, instance in ipairs(selected) do
		table.insert(results, instanceToInfo(instance, false))
	end
	
	return results
end

handlers["/code/run"] = function(data)
	if type(data.code) ~= "string" or data.code == "" then
		error("code must be a non-empty string")
	end
	if #data.code > MAX_RUN_CODE_BYTES then
		error("code exceeds the " .. MAX_RUN_CODE_BYTES .. "-byte limit")
	end

	local output = {}
	local outputBytes = 0
	local outputTruncated = false
	local function capturePrint(...)
		if outputTruncated then
			return
		end

		local str = ""
		for i = 1, select("#", ...) do
			if i > 1 then str = str .. "\t" end
			str = str .. tostring(select(i, ...))
		end
		if #output >= MAX_CAPTURED_OUTPUT_LINES or outputBytes + #str > MAX_CAPTURED_OUTPUT_BYTES then
			outputTruncated = true
			table.insert(output, "[output truncated]")
			return
		end

		outputBytes = outputBytes + #str
		table.insert(output, str)
	end

	local fn, compileError = loadstring(data.code, "bubbertron9001 agent code")
	if not fn then
		error(compileError)
	end

	-- Keep output capture local to the generated function instead of replacing
	-- Studio's process-wide print function.
	local baseEnvironment = getfenv(fn)
	local executionEnvironment = setmetatable({
		print = capturePrint,
	}, {
		__index = baseEnvironment,
	})
	setfenv(fn, executionEnvironment)

	local success, result = pcall(fn)
	if not success then
		return { output = table.concat(output, "\n"), error = tostring(result) }
	end
	
	if result ~= nil then
		capturePrint(result)
	end
	
	return { output = table.concat(output, "\n"), truncated = outputTruncated }
end

-- Curated starter-game installer. The desktop sends a locally compiled,
-- allowlisted change set; Studio independently enforces the bounded operation
-- vocabulary and exact reviewed script assets before applying anything.
local GAME_TEMPLATE_ID = "obby-starter"
local GAME_TEMPLATE_VERSION = "1.0.0"
local MAX_GAME_OPERATIONS = 512
local MAX_GAME_INSTANCES = 128
local MAX_GAME_ATTRIBUTES = 8
local MAX_GAME_PATH_BYTES = 512
local MAX_GAME_STABLE_ID_BYTES = 128
local MAX_GAME_SCRIPT_BYTES = 100 * 1024
local MAX_GAME_SNAPSHOT_INSTANCES = 2000
local GAME_CLAIMS = {
	"game.ServerScriptService.B9_ObbyServer",
	"game.StarterGui.B9_ObbyProgress",
	"game.Workspace.B9_Obby",
}
local GAME_BASE_PARENT_PATHS = {
	["game.ServerScriptService"] = true,
	["game.StarterGui"] = true,
	["game.Workspace"] = true,
}
local GAME_OWNERSHIP_MARKER_KEYS = {
	B9GenerationId = "generationId",
	B9TemplateId = "templateId",
	B9TemplateVersion = "templateVersion",
}
local GAME_ALLOWED_ATTRIBUTES = {
	B9GenerationId = true,
	B9TemplateId = true,
	B9TemplateVersion = true,
	B9StageNumber = true,
}
local GAME_ALLOWED_ENUMS = {
	["Enum.Font"] = {
		["Enum.Font.GothamBold"] = true,
	},
	["Enum.Material"] = {
		["Enum.Material.Grass"] = true,
		["Enum.Material.Neon"] = true,
		["Enum.Material.SmoothPlastic"] = true,
	},
}
local GAME_CLASS_PROPERTIES = {
	Folder = {},
	Model = {},
	Part = {
		Anchored = "boolean",
		CanCollide = "boolean",
		Color = "Color3",
		Material = "Enum.Material",
		Orientation = "Vector3",
		Position = "Vector3",
		Size = "Vector3",
		Transparency = "number",
	},
	SpawnLocation = {
		Anchored = "boolean",
		CanCollide = "boolean",
		Color = "Color3",
		Duration = "number",
		Enabled = "boolean",
		Material = "Enum.Material",
		Neutral = "boolean",
		Position = "Vector3",
		Size = "Vector3",
		Transparency = "number",
	},
	Script = {},
	LocalScript = {},
	ScreenGui = {
		DisplayOrder = "number",
		IgnoreGuiInset = "boolean",
		ResetOnSpawn = "boolean",
	},
	TextLabel = {
		BackgroundColor3 = "Color3",
		BackgroundTransparency = "number",
		Font = "Enum.Font",
		Position = "UDim2",
		Size = "UDim2",
		Text = "string",
		TextColor3 = "Color3",
		TextScaled = "boolean",
	},
}
local GAME_REQUIRED_CREATES = {
	["game.ServerScriptService.B9_ObbyServer"] = "Script",
	["game.StarterGui.B9_ObbyProgress"] = "ScreenGui",
	["game.StarterGui.B9_ObbyProgress.ProgressClient"] = "LocalScript",
	["game.StarterGui.B9_ObbyProgress.ProgressLabel"] = "TextLabel",
	["game.Workspace.B9_Obby"] = "Model",
	["game.Workspace.B9_Obby.Checkpoints"] = "Folder",
	["game.Workspace.B9_Obby.Finish"] = "Part",
	["game.Workspace.B9_Obby.KillFloor"] = "Part",
	["game.Workspace.B9_Obby.Stages"] = "Folder",
	["game.Workspace.B9_Obby.Start"] = "SpawnLocation",
}
local GAME_REQUIRED_PROPERTIES = {
	["game.StarterGui.B9_ObbyProgress"] = {
		DisplayOrder = true,
		IgnoreGuiInset = true,
		ResetOnSpawn = true,
	},
	["game.StarterGui.B9_ObbyProgress.ProgressLabel"] = {
		BackgroundColor3 = true,
		BackgroundTransparency = true,
		Font = true,
		Position = true,
		Size = true,
		Text = true,
		TextColor3 = true,
		TextScaled = true,
	},
	["game.Workspace.B9_Obby.Finish"] = {
		Anchored = true,
		CanCollide = true,
		Color = true,
		Material = true,
		Position = true,
		Size = true,
	},
	["game.Workspace.B9_Obby.KillFloor"] = {
		Anchored = true,
		CanCollide = true,
		Color = true,
		Material = true,
		Position = true,
		Size = true,
		Transparency = true,
	},
	["game.Workspace.B9_Obby.Start"] = {
		Anchored = true,
		CanCollide = true,
		Color = true,
		Duration = true,
		Enabled = true,
		Material = true,
		Neutral = true,
		Position = true,
		Size = true,
	},
}
local GAME_STAGE_PROPERTIES = {
	Anchored = true,
	CanCollide = true,
	Color = true,
	Material = true,
	Orientation = true,
	Position = true,
	Size = true,
}
local GAME_CHECKPOINT_PROPERTIES = {
	Anchored = true,
	CanCollide = true,
	Color = true,
	Duration = true,
	Enabled = true,
	Material = true,
	Neutral = true,
	Position = true,
	Size = true,
}
local TRUSTED_GAME_SCRIPTS = {
	["obby-server-v1"] = {
		targetPath = "game.ServerScriptService.B9_ObbyServer",
		hash = "96e80e697510eaf5d849c7467cfb76c792cd8d2636f9fcd9231154a389be85aa",
		source = [=[--!strict

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local root = Workspace:WaitForChild("B9_Obby")
local checkpoints = root:WaitForChild("Checkpoints")
local killFloor = root:WaitForChild("KillFloor")
local finish = root:WaitForChild("Finish")

local function playerFromHit(hit: BasePart): Player?
	local character = hit.Parent
	if character == nil then
		return nil
	end

	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if humanoid == nil then
		return nil
	end

	return Players:GetPlayerFromCharacter(character)
end

local function initializePlayer(player: Player)
	if player:GetAttribute("B9ObbyStage") == nil then
		player:SetAttribute("B9ObbyStage", 0)
	end
	if player:GetAttribute("B9ObbyFinished") == nil then
		player:SetAttribute("B9ObbyFinished", false)
	end
end

for _, checkpoint in checkpoints:GetChildren() do
	if checkpoint:IsA("SpawnLocation") then
		checkpoint.Touched:Connect(function(hit)
			local player = playerFromHit(hit)
			local stageNumber = checkpoint:GetAttribute("B9StageNumber")
			if player == nil or typeof(stageNumber) ~= "number" then
				return
			end

			local currentStage = player:GetAttribute("B9ObbyStage")
			if typeof(currentStage) ~= "number" or stageNumber > currentStage then
				player:SetAttribute("B9ObbyStage", stageNumber)
			end
			player.RespawnLocation = checkpoint
		end)
	end
end

if killFloor:IsA("BasePart") then
	killFloor.Touched:Connect(function(hit)
		local character = hit.Parent
		local humanoid = if character then character:FindFirstChildOfClass("Humanoid") else nil
		if humanoid then
			humanoid.Health = 0
		end
	end)
end

if finish:IsA("BasePart") then
	finish.Touched:Connect(function(hit)
		local player = playerFromHit(hit)
		if player then
			player:SetAttribute("B9ObbyFinished", true)
		end
	end)
end

Players.PlayerAdded:Connect(initializePlayer)
for _, player in Players:GetPlayers() do
	initializePlayer(player)
end
]=],
	},
	["obby-progress-v1"] = {
		targetPath = "game.StarterGui.B9_ObbyProgress.ProgressClient",
		hash = "9f8458aced9210e9e564e12e42eb6722e8998bf6dabad3c6c17b2b75aeba020d",
		source = [=[--!strict

local Players = game:GetService("Players")

local player = Players.LocalPlayer
local label = script.Parent:WaitForChild("ProgressLabel")

local function render()
	if not label:IsA("TextLabel") then
		return
	end

	if player:GetAttribute("B9ObbyFinished") == true then
		label.Text = "Obby complete!"
		return
	end

	local stage = player:GetAttribute("B9ObbyStage")
	local stageNumber = if typeof(stage) == "number" then stage else 0
	label.Text = string.format("Stage %d", stageNumber)
end

player:GetAttributeChangedSignal("B9ObbyStage"):Connect(render)
player:GetAttributeChangedSignal("B9ObbyFinished"):Connect(render)
render()
]=],
	},
}

local function gamePathWithin(path, root)
	return path == root or string.sub(path, 1, #root + 1) == root .. "."
end

local function gameClaimForPath(path)
	for _, claim in ipairs(GAME_CLAIMS) do
		if gamePathWithin(path, claim) then
			return claim
		end
	end
	return nil
end

local function getOptionalGameInstance(path)
	local instance, pathError = getInstanceFromPath(path)
	if instance then
		return instance
	end
	if type(pathError) ~= "string"
		or string.find(pathError, "No child named '", 1, true) ~= 1 then
		error("Starter-game path error: " .. tostring(pathError))
	end
	return nil
end

local function gameParentPath(path)
	return string.match(path, "^(.+)%.[^.]+$")
end

local function gameInstanceName(path)
	return string.match(path, "([^.]+)$")
end

local function gamePathDepth(path)
	return #string.split(path, ".")
end

local function isFiniteGameNumber(value)
	return type(value) == "number"
		and value == value
		and value ~= math.huge
		and value ~= -math.huge
end

local function isGameStableId(value)
	return type(value) == "string"
		and #value >= 1
		and #value <= MAX_GAME_STABLE_ID_BYTES
		and string.match(value, "^[A-Za-z0-9][A-Za-z0-9._:%-]*$") ~= nil
end

local function isGameSha256(value)
	return type(value) == "string"
		and #value == 64
		and string.match(value, "^[a-f0-9]+$") ~= nil
end

local function isGameStudioPath(value)
	if type(value) ~= "string" or #value < 6 or #value > MAX_GAME_PATH_BYTES then
		return false
	end
	local segments = string.split(value, ".")
	if segments[1] ~= "game" or #segments < 2 then
		return false
	end
	for index = 2, #segments do
		if string.match(segments[index], "^[A-Za-z_][A-Za-z0-9_]*$") == nil then
			return false
		end
	end
	return true
end

local function assertDenseGameArray(value, label, minimum, maximum)
	if type(value) ~= "table" then
		error(label .. " must be an array")
	end
	local count = 0
	for key in pairs(value) do
		if type(key) ~= "number" or key % 1 ~= 0 or key < 1 then
			error(label .. " must be a dense array")
		end
		count += 1
	end
	if count < minimum or count > maximum then
		error(label .. " count is outside its safety limit")
	end
	for index = 1, count do
		if value[index] == nil then
			error(label .. " must be a dense array")
		end
	end
	return count
end

local function assertGameObjectKeys(value, allowedKeys, label)
	if type(value) ~= "table" then
		error(label .. " must be an object")
	end
	for key in pairs(value) do
		if type(key) ~= "string" or not allowedKeys[key] then
			error(label .. " contains an unsupported field")
		end
	end
end

local function gameMarkersEqual(left, right)
	return type(left) == "table"
		and type(right) == "table"
		and left.generationId == right.generationId
		and left.templateId == right.templateId
		and left.templateVersion == right.templateVersion
end

local function decodeGameProperty(value, expectedKind)
	if expectedKind == "string" then
		if type(value) ~= "string" or #value > 4000 then
			error("Expected bounded string property value")
		end
		return value
	end
	if expectedKind == "number" then
		if not isFiniteGameNumber(value) or value < -1000000 or value > 1000000 then
			error("Expected bounded number property value")
		end
		return value
	end
	if expectedKind == "boolean" then
		if type(value) ~= "boolean" then
			error("Expected " .. expectedKind .. " property value")
		end
		return value
	end
	if expectedKind == "Vector3" then
		assertGameObjectKeys(value, { type = true, x = true, y = true, z = true }, "Vector3 value")
		if value.type ~= "Vector3"
			or not isFiniteGameNumber(value.x) or math.abs(value.x) > 100000
			or not isFiniteGameNumber(value.y) or math.abs(value.y) > 100000
			or not isFiniteGameNumber(value.z) or math.abs(value.z) > 100000 then
			error("Expected bounded Vector3 property value")
		end
		return Vector3.new(value.x, value.y, value.z)
	end
	if expectedKind == "Color3" then
		assertGameObjectKeys(value, { type = true, r = true, g = true, b = true }, "Color3 value")
		if value.type ~= "Color3"
			or not isFiniteGameNumber(value.r) or value.r < 0 or value.r > 1
			or not isFiniteGameNumber(value.g) or value.g < 0 or value.g > 1
			or not isFiniteGameNumber(value.b) or value.b < 0 or value.b > 1 then
			error("Expected bounded Color3 property value")
		end
		return Color3.new(value.r, value.g, value.b)
	end
	if expectedKind == "UDim2" then
		assertGameObjectKeys(
			value,
			{ type = true, xScale = true, xOffset = true, yScale = true, yOffset = true },
			"UDim2 value"
		)
		if value.type ~= "UDim2"
			or not isFiniteGameNumber(value.xScale) or math.abs(value.xScale) > 10
			or not isFiniteGameNumber(value.xOffset) or math.abs(value.xOffset) > 10000
			or not isFiniteGameNumber(value.yScale) or math.abs(value.yScale) > 10
			or not isFiniteGameNumber(value.yOffset) or math.abs(value.yOffset) > 10000 then
			error("Expected bounded UDim2 property value")
		end
		return UDim2.new(value.xScale, value.xOffset, value.yScale, value.yOffset)
	end
	if GAME_ALLOWED_ENUMS[expectedKind] then
		assertGameObjectKeys(value, { type = true, value = true }, "Enum value")
		if value.type ~= "Enum" or not GAME_ALLOWED_ENUMS[expectedKind][value.value] then
			error("Enum property value is not allowlisted")
		end
		local enumTypeName, enumItemName = string.match(value.value or "", "^Enum%.([%w_]+)%.([%w_]+)$")
		local enumType = enumTypeName and Enum[enumTypeName]
		local enumItem = enumType and enumType[enumItemName]
		if not enumItem then
			error("Invalid enum property value")
		end
		return enumItem
	end
	error("Unsupported property value kind")
end

local function encodeGameProperty(value)
	local kind = typeof(value)
	if kind == "string" then
		return string.sub(value, 1, 4000)
	end
	if kind == "Vector3" then
		return { type = "Vector3", x = value.X, y = value.Y, z = value.Z }
	end
	if kind == "Color3" then
		return { type = "Color3", r = value.R, g = value.G, b = value.B }
	end
	if kind == "UDim2" then
		return {
			type = "UDim2",
			xScale = value.X.Scale,
			xOffset = value.X.Offset,
			yScale = value.Y.Scale,
			yOffset = value.Y.Offset,
		}
	end
	if kind == "EnumItem" then
		return { type = "Enum", value = tostring(value) }
	end
	return value
end

local function gameRevisionValue(value)
	local kind = typeof(value)
	if kind == "Vector3" then
		return string.format("Vector3(%.17g,%.17g,%.17g)", value.X, value.Y, value.Z)
	end
	if kind == "Color3" then
		return string.format("Color3(%.17g,%.17g,%.17g)", value.R, value.G, value.B)
	end
	if kind == "UDim2" then
		return string.format(
			"UDim2(%.17g,%.17g,%.17g,%.17g)",
			value.X.Scale,
			value.X.Offset,
			value.Y.Scale,
			value.Y.Offset
		)
	end
	return kind .. "(" .. tostring(value) .. ")"
end

local function readGameScriptSource(instance)
	if not instance:IsA("LuaSourceContainer") then
		return nil
	end
	local editorSuccess, editorSource = pcall(function()
		return ScriptEditorService:GetEditorSource(instance)
	end)
	if editorSuccess and type(editorSource) == "string" then
		return editorSource
	end
	local sourceSuccess, source = pcall(function()
		return instance.Source
	end)
	if sourceSuccess and type(source) == "string" then
		return source
	end
	return nil
end

local TRUSTED_GAME_SCRIPTS_BY_PATH = {}
for _, trusted in pairs(TRUSTED_GAME_SCRIPTS) do
	TRUSTED_GAME_SCRIPTS_BY_PATH[trusted.targetPath] = trusted
end

local function gameValuesEqual(actual, expected, expectedKind)
	local decoded = decodeGameProperty(expected, expectedKind)
	local kind = typeof(decoded)
	if kind == "Vector3" then
		return (actual - decoded).Magnitude < 0.0001
	end
	if kind == "Color3" then
		return math.abs(actual.R - decoded.R) < 0.0001
			and math.abs(actual.G - decoded.G) < 0.0001
			and math.abs(actual.B - decoded.B) < 0.0001
	end
	return actual == decoded
end

local function gameSnapshot(templateId)
	if templateId ~= GAME_TEMPLATE_ID then
		error("Unknown starter-game template")
	end
	local instances = {}
	local revisionParts = {}
	for _, claim in ipairs(GAME_CLAIMS) do
		local root = getOptionalGameInstance(claim)
		if root then
			local candidates = { root }
			local descendants = root:GetDescendants()
			if #instances + #descendants + 1 > MAX_GAME_SNAPSHOT_INSTANCES then
				error("Starter-game snapshot exceeds its instance safety limit")
			end
			for _, descendant in ipairs(descendants) do
				table.insert(candidates, descendant)
			end
			table.sort(candidates, function(left, right)
				return getInstancePath(left) < getInstancePath(right)
			end)
			for _, instance in ipairs(candidates) do
				local path = getInstancePath(instance)
				local generationId = instance:GetAttribute("B9GenerationId")
				local ownedTemplateId = instance:GetAttribute("B9TemplateId")
				local templateVersion = instance:GetAttribute("B9TemplateVersion")
				local info = { path = path, className = instance.ClassName }
				if isGameStableId(generationId)
					and isGameStableId(ownedTemplateId)
					and type(templateVersion) == "string"
					and string.match(templateVersion, "^%d+%.%d+%.%d+$") ~= nil then
					info.ownership = {
						generationId = generationId,
						templateId = ownedTemplateId,
						templateVersion = templateVersion,
					}
				end
				local propertySpec = GAME_CLASS_PROPERTIES[instance.ClassName]
				if propertySpec then
					local properties = {}
					local propertyNames = {}
					for propertyName in pairs(propertySpec) do
						table.insert(propertyNames, propertyName)
					end
					table.sort(propertyNames)
					for _, propertyName in ipairs(propertyNames) do
						local ok, propertyValue = pcall(function()
							return instance[propertyName]
						end)
						if ok then
							properties[propertyName] = encodeGameProperty(propertyValue)
							table.insert(
								revisionParts,
								path .. ":property:" .. propertyName .. "=" .. gameRevisionValue(propertyValue)
							)
						end
					end
					info.properties = properties
				end
				local sourceHash = instance:GetAttribute("B9SourceHash")
				local trustedScript = TRUSTED_GAME_SCRIPTS_BY_PATH[path]
				if trustedScript then
					local actualSource = readGameScriptSource(instance)
					if actualSource == trustedScript.source and sourceHash == trustedScript.hash then
						info.scriptHash = trustedScript.hash
					end
					local revisionSource = actualSource
					if type(revisionSource) ~= "string" then
						revisionSource = "<unreadable>"
					elseif #revisionSource > MAX_GAME_SCRIPT_BYTES then
						revisionSource = string.sub(revisionSource, 1, MAX_GAME_SCRIPT_BYTES)
							.. ":<truncated>:"
							.. tostring(#actualSource)
					end
					table.insert(revisionParts, path .. ":source=" .. revisionSource)
				end
				local attributeNames = {
					"B9GenerationId",
					"B9SourceHash",
					"B9StageNumber",
					"B9TemplateId",
					"B9TemplateVersion",
				}
				for _, attributeName in ipairs(attributeNames) do
					table.insert(
						revisionParts,
						path
							.. ":attribute:"
							.. attributeName
							.. "="
							.. gameRevisionValue(instance:GetAttribute(attributeName))
					)
				end
				table.insert(revisionParts, path .. ":class=" .. instance.ClassName)
				table.insert(instances, info)
			end
		end
	end

	local hash = 5381
	local revisionText = table.concat(revisionParts, "|")
	for index = 1, #revisionText do
		hash = (hash * 33 + string.byte(revisionText, index)) % 4294967296
	end
	return {
		schemaVersion = "b9.studio-snapshot/v1",
		revision = string.format("revision-%08x", math.floor(hash)),
		completePaths = GAME_CLAIMS,
		contentHashes = {},
		instances = instances,
	}
end

local function validateGameChangeSet(changeSet)
	if type(changeSet) ~= "table"
		or changeSet.schemaVersion ~= "b9.changeset/v1"
		or type(changeSet.source) ~= "table"
		or changeSet.source.type ~= "game_template"
		or changeSet.source.templateId ~= GAME_TEMPLATE_ID
		or changeSet.source.templateVersion ~= GAME_TEMPLATE_VERSION
		or not isGameSha256(changeSet.source.optionsHash) then
		error("Unsupported starter-game change set")
	end

	if type(changeSet.base) ~= "table"
		or not isGameStableId(changeSet.base.studioRevision)
		or type(changeSet.base.contentHashes) ~= "table" then
		error("Invalid starter-game base snapshot")
	end
	local contentHashCount = 0
	for path, hash in pairs(changeSet.base.contentHashes) do
		contentHashCount += 1
		if contentHashCount > MAX_GAME_INSTANCES
			or not isGameStudioPath(path)
			or not gameClaimForPath(path)
			or not isGameSha256(hash) then
			error("Invalid starter-game base content hash")
		end
	end

	local marker = changeSet.ownership and changeSet.ownership.marker
	if type(marker) ~= "table"
		or not isGameStableId(marker.generationId)
		or marker.templateId ~= GAME_TEMPLATE_ID
		or marker.templateVersion ~= GAME_TEMPLATE_VERSION then
		error("Invalid starter-game ownership marker")
	end

	assertDenseGameArray(changeSet.claims, "Starter-game claims", #GAME_CLAIMS, #GAME_CLAIMS)
	local expectedClaims = {}
	for _, claim in ipairs(GAME_CLAIMS) do
		expectedClaims[claim] = true
	end
	for _, claim in ipairs(changeSet.claims) do
		if type(claim) ~= "table"
			or claim.access ~= "exclusive_create"
			or not expectedClaims[claim.path] then
			error("Starter-game claims do not match the curated template")
		end
		expectedClaims[claim.path] = nil
	end
	if next(expectedClaims) ~= nil then
		error("Starter-game claims are incomplete")
	end

	assertDenseGameArray(
		changeSet.operations,
		"Starter-game operations",
		1,
		MAX_GAME_OPERATIONS
	)
	local createsByPath = {}
	local operationsById = {}
	local createCount = 0
	for _, operation in ipairs(changeSet.operations) do
		if type(operation) ~= "table"
			or not isGameStableId(operation.operationId)
			or operationsById[operation.operationId] then
			error("Invalid or duplicate starter-game operation ID")
		end
		operationsById[operation.operationId] = operation
		if not isGameStudioPath(operation.targetPath)
			or operation.claimPath ~= gameClaimForPath(operation.targetPath) then
			error("Starter-game operation escaped its claim")
		end

		if operation.type == "create_instance" then
			createCount += 1
			if createCount > MAX_GAME_INSTANCES
				or not GAME_CLASS_PROPERTIES[operation.className]
				or operation.parentPath ~= gameParentPath(operation.targetPath)
				or operation.name ~= gameInstanceName(operation.targetPath)
				or type(operation.name) ~= "string"
				or #operation.name > 64
				or string.match(operation.name, "^[A-Za-z_][A-Za-z0-9_]*$") == nil
				or createsByPath[operation.targetPath] then
				error("Invalid starter-game create operation")
			end
			if not gameMarkersEqual(operation.ownership, marker)
				or type(operation.attributes) ~= "table" then
				error("Starter-game create ownership does not match")
			end

			local attributeCount = 0
			for attribute, value in pairs(operation.attributes) do
				attributeCount += 1
				if attributeCount > MAX_GAME_ATTRIBUTES
					or not GAME_ALLOWED_ATTRIBUTES[attribute]
					or (type(value) ~= "string"
						and type(value) ~= "number"
						and type(value) ~= "boolean") then
					error("Unsupported starter-game attribute")
				end
				if type(value) == "string" and #value > 256 then
					error("Starter-game attribute string is too large")
				end
				if type(value) == "number" and not isFiniteGameNumber(value) then
					error("Starter-game attribute number must be finite")
				end
			end
			for ownershipAttribute, markerKey in pairs(GAME_OWNERSHIP_MARKER_KEYS) do
				if operation.attributes[ownershipAttribute] ~= marker[markerKey] then
					error("Starter-game create ownership attributes do not match")
				end
			end
			local stageNumber = operation.attributes.B9StageNumber
			if stageNumber ~= nil
				and (not isFiniteGameNumber(stageNumber)
					or stageNumber % 1 ~= 0
					or stageNumber < 1
					or stageNumber > 15) then
				error("Starter-game stage number is outside the template bounds")
			end
			createsByPath[operation.targetPath] = operation
		elseif operation.type ~= "set_property" and operation.type ~= "set_script_source" then
			error("Unsupported starter-game operation")
		end
	end
	if createCount < 1 then
		error("Starter-game change set creates no instances")
	end

	for path, create in pairs(createsByPath) do
		if not GAME_BASE_PARENT_PATHS[create.parentPath]
			and not createsByPath[create.parentPath] then
			error("Starter-game create parent is outside the bounded manifest: " .. path)
		end
	end
	for requiredPath, requiredClass in pairs(GAME_REQUIRED_CREATES) do
		local create = createsByPath[requiredPath]
		if not create or create.className ~= requiredClass then
			error("Starter-game change set is missing required instance: " .. requiredPath)
		end
	end

	local stages = {}
	local checkpoints = {}
	for path, create in pairs(createsByPath) do
		if not GAME_REQUIRED_CREATES[path] then
			local stageText = string.match(
				path,
				"^game%.Workspace%.B9_Obby%.Stages%.Stage_(%d%d)$"
			)
			local checkpointText = string.match(
				path,
				"^game%.Workspace%.B9_Obby%.Checkpoints%.Checkpoint_(%d%d)$"
			)
			if stageText and create.className == "Part" then
				local stage = tonumber(stageText)
				if not stage or stages[stage]
					or create.attributes.B9StageNumber ~= stage then
					error("Invalid starter-game stage instance: " .. path)
				end
				stages[stage] = true
			elseif checkpointText and create.className == "SpawnLocation" then
				local stage = tonumber(checkpointText)
				if not stage or checkpoints[stage]
					or create.attributes.B9StageNumber ~= stage then
					error("Invalid starter-game checkpoint instance: " .. path)
				end
				checkpoints[stage] = true
			else
				error("Starter-game instance is outside the curated structure: " .. path)
			end
		elseif create.attributes.B9StageNumber ~= nil then
			error("Only stage and checkpoint instances may carry B9StageNumber")
		end
	end

	local stageCount = 0
	for stage in pairs(stages) do
		stageCount += 1
		if not checkpoints[stage] then
			error("Starter-game stage is missing its checkpoint")
		end
	end
	local checkpointCount = 0
	for stage in pairs(checkpoints) do
		checkpointCount += 1
		if not stages[stage] then
			error("Starter-game checkpoint is missing its stage")
		end
	end
	if stageCount ~= checkpointCount
		or (stageCount ~= 5 and stageCount ~= 10 and stageCount ~= 15) then
		error("Starter-game stage count must be 5, 10, or 15")
	end
	for stage = 1, stageCount do
		if not stages[stage] or not checkpoints[stage] then
			error("Starter-game stages must be sequential")
		end
	end
	if createCount ~= 10 + stageCount * 2 then
		error("Starter-game instance count does not match its stage count")
	end

	local propertiesByPath = {}
	local mutationKeys = {}
	local trustedAssets = {}
	for _, operation in ipairs(changeSet.operations) do
		if operation.type ~= "create_instance" then
			local create = createsByPath[operation.targetPath]
			if not create then
				error("Starter-game mutation target is not manifest-owned")
			end
			if operation.type == "set_property" then
				if type(operation.property) ~= "string" or #operation.property > 64 then
					error("Invalid starter-game property name")
				end
				local expectedKind = GAME_CLASS_PROPERTIES[create.className][operation.property]
				local mutationKey = operation.targetPath .. ":property:" .. tostring(operation.property)
				if not expectedKind or mutationKeys[mutationKey] then
					error("Unsupported or duplicate starter-game property")
				end
				decodeGameProperty(operation.value, expectedKind)
				mutationKeys[mutationKey] = true
				propertiesByPath[operation.targetPath] =
					propertiesByPath[operation.targetPath] or {}
				propertiesByPath[operation.targetPath][operation.property] = true
			else
				if not isGameStableId(operation.assetId) then
					error("Invalid starter-game script asset ID")
				end
				local trusted = TRUSTED_GAME_SCRIPTS[operation.assetId]
				local mutationKey = operation.targetPath .. ":script"
				if mutationKeys[mutationKey]
					or trustedAssets[operation.assetId]
					or (create.className ~= "Script" and create.className ~= "LocalScript")
					or not trusted
					or trusted.targetPath ~= operation.targetPath
					or trusted.hash ~= operation.sourceHash
					or trusted.source ~= operation.source
					or operation.trust ~= "bundled_reviewed" then
					error("Starter-game script is not the exact reviewed asset")
				end
				mutationKeys[mutationKey] = true
				trustedAssets[operation.assetId] = true
			end
		end
	end
	for assetId in pairs(TRUSTED_GAME_SCRIPTS) do
		if not trustedAssets[assetId] then
			error("Starter-game change set is missing reviewed script: " .. assetId)
		end
	end

	for path in pairs(createsByPath) do
		local requiredProperties = GAME_REQUIRED_PROPERTIES[path]
		if string.match(path, "^game%.Workspace%.B9_Obby%.Stages%.Stage_%d%d$") then
			requiredProperties = GAME_STAGE_PROPERTIES
		elseif string.match(
			path,
			"^game%.Workspace%.B9_Obby%.Checkpoints%.Checkpoint_%d%d$"
		) then
			requiredProperties = GAME_CHECKPOINT_PROPERTIES
		end
		local actualProperties = propertiesByPath[path] or {}
		if requiredProperties then
			for property in pairs(requiredProperties) do
				if not actualProperties[property] then
					error("Starter-game instance is missing required property: " .. path .. "." .. property)
				end
			end
			for property in pairs(actualProperties) do
				if not requiredProperties[property] then
					error("Starter-game instance has an unexpected property: " .. path .. "." .. property)
				end
			end
		elseif next(actualProperties) ~= nil then
			error("Starter-game container has unexpected properties: " .. path)
		end
	end

	assertDenseGameArray(
		changeSet.ownership.ownedPaths,
		"Starter-game owned paths",
		createCount,
		createCount
	)
	local ownedPaths = {}
	for _, path in ipairs(changeSet.ownership.ownedPaths) do
		if ownedPaths[path] or not createsByPath[path] then
			error("Starter-game owned paths do not match its created instances")
		end
		ownedPaths[path] = true
	end

	local cleanup = changeSet.cleanup
	if type(cleanup) ~= "table"
		or cleanup.strategy ~= "delete_owned_paths"
		or cleanup.requireOwnershipMatch ~= true
		or cleanup.preserveUnknownDescendants ~= true then
		error("Invalid starter-game cleanup contract")
	end
	assertDenseGameArray(cleanup.paths, "Starter-game cleanup paths", createCount, createCount)
	local expectedCleanup = {}
	for path in pairs(createsByPath) do
		table.insert(expectedCleanup, path)
	end
	table.sort(expectedCleanup, function(left, right)
		local leftDepth = gamePathDepth(left)
		local rightDepth = gamePathDepth(right)
		return leftDepth > rightDepth or (leftDepth == rightDepth and left > right)
	end)
	for index, path in ipairs(cleanup.paths) do
		if path ~= expectedCleanup[index] then
			error("Starter-game cleanup paths are not complete and leaf-first")
		end
	end

	assertDenseGameArray(
		changeSet.verification,
		"Starter-game verification assertions",
		1,
		1024
	)
	local expectedAssertionKeys = {}
	for _, operation in ipairs(changeSet.operations) do
		if operation.type == "create_instance" then
			expectedAssertionKeys["instance:" .. operation.operationId] = true
			expectedAssertionKeys["ownership:" .. operation.operationId] = true
		elseif operation.type == "set_property" then
			expectedAssertionKeys["property:" .. operation.operationId] = true
		else
			expectedAssertionKeys["script_hash:" .. operation.operationId] = true
		end
	end

	local assertionIds = {}
	for _, assertion in ipairs(changeSet.verification) do
		if type(assertion) ~= "table"
			or not isGameStableId(assertion.assertionId)
			or assertionIds[assertion.assertionId]
			or not isGameStableId(assertion.operationId) then
			error("Invalid or duplicate starter-game verification assertion")
		end
		local operation = operationsById[assertion.operationId]
		if not operation or assertion.path ~= operation.targetPath then
			error("Starter-game verification assertion escaped its operation")
		end

		local assertionKey = tostring(assertion.type) .. ":" .. assertion.operationId
		if not expectedAssertionKeys[assertionKey] then
			error("Unexpected or duplicate starter-game verification assertion")
		end
		if assertion.type == "instance" then
			assertGameObjectKeys(assertion, {
				assertionId = true,
				operationId = true,
				path = true,
				type = true,
				className = true,
			}, "Instance verification assertion")
			if operation.type ~= "create_instance"
				or assertion.className ~= operation.className then
				error("Starter-game instance assertion does not match its create operation")
			end
		elseif assertion.type == "ownership" then
			assertGameObjectKeys(assertion, {
				assertionId = true,
				operationId = true,
				path = true,
				type = true,
				expected = true,
			}, "Ownership verification assertion")
			assertGameObjectKeys(assertion.expected, {
				generationId = true,
				templateId = true,
				templateVersion = true,
			}, "Ownership verification value")
			if operation.type ~= "create_instance"
				or not gameMarkersEqual(assertion.expected, marker) then
				error("Starter-game ownership assertion does not match its create operation")
			end
		elseif assertion.type == "property" then
			assertGameObjectKeys(assertion, {
				assertionId = true,
				operationId = true,
				path = true,
				type = true,
				property = true,
				expected = true,
			}, "Property verification assertion")
			if operation.type ~= "set_property"
				or assertion.property ~= operation.property then
				error("Starter-game property assertion does not match its operation")
			end
			local create = createsByPath[operation.targetPath]
			local expectedKind = GAME_CLASS_PROPERTIES[create.className][operation.property]
			local operationValue = decodeGameProperty(operation.value, expectedKind)
			if not gameValuesEqual(operationValue, assertion.expected, expectedKind) then
				error("Starter-game property assertion expected value does not match")
			end
		elseif assertion.type == "script_hash" then
			assertGameObjectKeys(assertion, {
				assertionId = true,
				operationId = true,
				path = true,
				type = true,
				expectedHash = true,
			}, "Script verification assertion")
			if operation.type ~= "set_script_source"
				or assertion.expectedHash ~= operation.sourceHash then
				error("Starter-game script assertion does not match its operation")
			end
		else
			error("Unsupported starter-game verification assertion")
		end

		assertionIds[assertion.assertionId] = true
		expectedAssertionKeys[assertionKey] = nil
	end
	if next(expectedAssertionKeys) ~= nil then
		error("Starter-game verification assertions are incomplete")
	end
	return marker, createsByPath, operationsById
end

local function assertGameOwnership(instance, marker)
	if instance:GetAttribute("B9GenerationId") ~= marker.generationId
		or instance:GetAttribute("B9TemplateId") ~= marker.templateId
		or instance:GetAttribute("B9TemplateVersion") ~= marker.templateVersion then
		error("Starter-game path is owned by another generation: " .. getInstancePath(instance))
	end
end

local function verifyGameChangeSet(changeSet)
	local marker, createsByPath, operationsById = validateGameChangeSet(changeSet)
	local verified = {}
	for _, assertion in ipairs(changeSet.verification) do
		local operation = operationsById[assertion.operationId]
		local instance = requireInstanceFromPath(assertion.path, "Generated instance")
		if assertion.type == "instance" then
			if instance.ClassName ~= assertion.className then
				error("Generated instance class mismatch: " .. assertion.path)
			end
			for attribute, expected in pairs(operation.attributes) do
				if instance:GetAttribute(attribute) ~= expected then
					error("Generated attribute verification failed: " .. assertion.path .. "." .. attribute)
				end
			end
		elseif assertion.type == "ownership" then
			assertGameOwnership(instance, marker)
		elseif assertion.type == "property" then
			local create = createsByPath[assertion.path]
			local expectedKind = GAME_CLASS_PROPERTIES[create.className][assertion.property]
			if not gameValuesEqual(instance[assertion.property], assertion.expected, expectedKind) then
				error("Generated property verification failed: " .. assertion.path .. "." .. assertion.property)
			end
		elseif assertion.type == "script_hash" then
			local trusted = TRUSTED_GAME_SCRIPTS[operation.assetId]
			local source = readGameScriptSource(instance)
			if source ~= trusted.source or instance:GetAttribute("B9SourceHash") ~= trusted.hash then
				error("Generated script verification failed: " .. assertion.path)
			end
		end
		table.insert(verified, assertion.assertionId)
	end
	table.sort(verified)
	return verified
end

handlers["/game/snapshot"] = function(data)
	return gameSnapshot(data.templateId)
end

handlers["/game/install"] = function(data)
	local changeSet = data.changeSet
	local marker, createsByPath, operationsById = validateGameChangeSet(changeSet)
	local currentSnapshot = gameSnapshot(GAME_TEMPLATE_ID)
	if changeSet.base.studioRevision ~= currentSnapshot.revision then
		error("Studio changed after Change Preview. Review the starter again before generating.")
	end
	for path, expectedHash in pairs(changeSet.base.contentHashes) do
		if currentSnapshot.contentHashes[path] ~= expectedHash then
			error("Studio content changed after Change Preview: " .. path)
		end
	end

	local selected = {}
	if data.operationIds == nil then
		for operationId in pairs(operationsById) do
			selected[operationId] = true
		end
	else
		assertDenseGameArray(
			data.operationIds,
			"Starter-game operation selection",
			0,
			MAX_GAME_OPERATIONS
		)
		for _, operationId in ipairs(data.operationIds) do
			if not isGameStableId(operationId)
				or not operationsById[operationId]
				or selected[operationId] then
				error("Unknown or duplicate starter-game operation selection")
			end
			selected[operationId] = true
		end
	end

	for path, create in pairs(createsByPath) do
		local existing = getOptionalGameInstance(path)
		if existing then
			if existing.ClassName ~= create.className then
				error("Starter-game name collision: " .. path)
			end
			assertGameOwnership(existing, marker)
			for attribute, expected in pairs(create.attributes) do
				if existing:GetAttribute(attribute) ~= expected then
					error("Starter-game owned instance was modified: " .. path .. "." .. attribute)
				end
			end
		elseif not selected[create.operationId] then
			error("Starter-game resume is missing a required create operation: " .. path)
		end
	end

	local rollback = {}
	local applied = {}
	local assertions = nil
	local success, installError = pcall(function()
		for _, operation in ipairs(changeSet.operations) do
			if selected[operation.operationId] and operation.type == "create_instance" then
				local existing = getOptionalGameInstance(operation.targetPath)
				if not existing then
					local parent = requireInstanceFromPath(operation.parentPath, "Generated parent")
					assertUniqueChildName(parent, operation.name)
					local instance = Instance.new(operation.className)
					instance.Name = operation.name
					for attribute, value in pairs(operation.attributes) do
						instance:SetAttribute(attribute, value)
					end
					instance.Parent = parent
					local rollbackInstance = instance
					table.insert(rollback, function()
						if rollbackInstance.Parent then
							rollbackInstance:Destroy()
						end
					end)
				end
				table.insert(applied, operation.operationId)
			end
		end
		for _, operation in ipairs(changeSet.operations) do
			if selected[operation.operationId] and operation.type == "set_property" then
				local instance = requireInstanceFromPath(operation.targetPath)
				local propertyName = operation.property
				local previous = instance[propertyName]
				local rollbackInstance = instance
				table.insert(rollback, function()
					rollbackInstance[propertyName] = previous
				end)
				local className = createsByPath[operation.targetPath].className
				local expectedKind = GAME_CLASS_PROPERTIES[className][propertyName]
				instance[propertyName] = decodeGameProperty(operation.value, expectedKind)
				table.insert(applied, operation.operationId)
			elseif selected[operation.operationId] and operation.type == "set_script_source" then
				local instance = requireInstanceFromPath(operation.targetPath, "Generated script")
				local previousSource = readGameScriptSource(instance)
				if type(previousSource) ~= "string" then
					error("Generated script source could not be read before installation")
				end
				local previousHash = instance:GetAttribute("B9SourceHash")
				local rollbackInstance = instance
				table.insert(rollback, function()
					ScriptEditorService:UpdateSourceAsync(rollbackInstance, function()
						return previousSource
					end)
					rollbackInstance:SetAttribute("B9SourceHash", previousHash)
				end)
				local trusted = TRUSTED_GAME_SCRIPTS[operation.assetId]
				ScriptEditorService:UpdateSourceAsync(instance, function()
					return trusted.source
				end)
				instance:SetAttribute("B9SourceHash", trusted.hash)
				table.insert(applied, operation.operationId)
			end
		end
		assertions = verifyGameChangeSet(changeSet)
	end)

	if not success then
		local cleanupFailures = {}
		for index = #rollback, 1, -1 do
			local cleaned, cleanupError = pcall(rollback[index])
			if not cleaned then
				table.insert(cleanupFailures, tostring(cleanupError))
			end
		end
		error(
			"Starter-game install failed: "
				.. tostring(installError)
				.. (#cleanupFailures > 0
					and "; cleanup failures: " .. table.concat(cleanupFailures, "; ")
					or "")
		)
	end

	table.sort(applied)
	return {
		status = "installed",
		generationId = marker.generationId,
		appliedOperationIds = applied,
		verifiedAssertionIds = assertions,
		verified = true,
		completionLabel = "Ready to playtest",
		handoff = "playtest-and-fix",
	}
end

handlers["/game/verify"] = function(data)
	local assertions = verifyGameChangeSet(data.changeSet)
	return { verified = true, verifiedAssertionIds = assertions }
end

handlers["/game/remove"] = function(data)
	local changeSet = data.changeSet
	local marker = validateGameChangeSet(changeSet)
	local currentSnapshot = gameSnapshot(GAME_TEMPLATE_ID)
	if changeSet.base.studioRevision ~= currentSnapshot.revision then
		error("Studio changed after the removal preview. Review the generated game again before removing it.")
	end
	for path, expectedHash in pairs(changeSet.base.contentHashes) do
		if currentSnapshot.contentHashes[path] ~= expectedHash then
			error("Studio content changed after the removal preview: " .. path)
		end
	end
	local owned = {}
	for _, path in ipairs(changeSet.ownership.ownedPaths) do
		owned[path] = true
	end

	local planned = {}
	local skipped = {}
	for _, path in ipairs(changeSet.cleanup.paths) do
		local instance = getOptionalGameInstance(path)
		if not instance then
			table.insert(skipped, path)
		else
			assertGameOwnership(instance, marker)
			local hasUnknownDescendant = false
			for _, descendant in ipairs(instance:GetDescendants()) do
				if not owned[getInstancePath(descendant)] then
					hasUnknownDescendant = true
					break
				end
			end
			table.insert(planned, {
				path = path,
				instance = instance,
				preserve = hasUnknownDescendant,
			})
		end
	end

	local removed = {}
	local preserved = {}
	local failures = {}
	for _, item in ipairs(planned) do
		if item.preserve then
			table.insert(preserved, item.path)
		else
			local removedSuccessfully, removeError = pcall(function()
				item.instance:Destroy()
			end)
			if not removedSuccessfully then
				table.insert(failures, {
					path = item.path,
					error = tostring(removeError),
				})
			elseif getOptionalGameInstance(item.path) then
				table.insert(failures, {
					path = item.path,
					error = "Path still exists after removal",
				})
			else
				table.insert(removed, item.path)
			end
		end
	end
	for _, path in ipairs(preserved) do
		if not getOptionalGameInstance(path) then
			table.insert(failures, {
				path = path,
				error = "Preserved path disappeared during removal",
			})
		end
	end

	table.sort(removed)
	table.sort(preserved)
	table.sort(skipped)
	table.sort(failures, function(left, right)
		return left.path < right.path
	end)
	return {
		status = #failures == 0 and "removed" or "partial",
		removed = removed,
		preserved = preserved,
		skipped = skipped,
		failures = failures,
		generationId = marker.generationId,
		verified = #failures == 0,
	}
end

local function getRelativeInventoryPath(root, instance)
	local parts = {}
	local current = instance
	while current and current ~= root do
		table.insert(parts, 1, current.Name)
		current = current.Parent
	end
	table.insert(parts, 1, root.Name)
	return table.concat(parts, "/")
end

local function quarantineImportedScripts(root)
	local inventory = {}
	local disabledCount = 0
	local candidates = { root }
	local descendants = root:GetDescendants()
	if #descendants > MAX_IMPORTED_DESCENDANTS then
		error(
			"Imported asset contains "
				.. #descendants
				.. " descendants, exceeding the safety limit of "
				.. MAX_IMPORTED_DESCENDANTS
		)
	end
	for _, descendant in ipairs(descendants) do
		table.insert(candidates, descendant)
	end

	for _, candidate in ipairs(candidates) do
		if candidate:IsA("LuaSourceContainer") then
			if #inventory >= MAX_IMPORTED_SCRIPT_INVENTORY then
				error(
					"Imported asset contains more than "
						.. MAX_IMPORTED_SCRIPT_INVENTORY
						.. " scripts and cannot be safely inventoried"
				)
			end
			local entry = {
				name = candidate.Name,
				className = candidate.ClassName,
				relativePath = getRelativeInventoryPath(root, candidate),
				quarantined = false,
			}
			if candidate:IsA("BaseScript") then
				entry.wasEnabled = candidate.Enabled
				candidate.Enabled = false
				if candidate.Enabled then
					error("Failed to quarantine imported script " .. entry.relativePath)
				end
				entry.quarantined = true
				disabledCount = disabledCount + 1
			end
			table.insert(inventory, entry)
		end
	end

	return inventory, disabledCount
end

-- Asset insertion (from Creator Store)
handlers["/asset/insert"] = function(data)
	local parent = requireInstanceFromPath(data.parent, "Parent")

	local assetId = tonumber(data.assetId)
	if not assetId then
		error("Invalid asset ID: " .. tostring(data.assetId))
	end

	-- Use InsertService to get the asset
	local InsertService = game:GetService("InsertService")
	local success, model = pcall(function()
		return InsertService:LoadAsset(assetId)
	end)

	if not success then
		-- Try alternative method
		success, model = pcall(function()
			local objects = game:GetObjects("rbxassetid://" .. assetId)
			if objects and #objects > 0 then
				return objects[1]
			end
			error("No objects returned")
		end)
	end

	if not success or not model then
		error("Failed to load asset " .. assetId .. ": " .. tostring(model))
	end

	-- If it's a Model wrapper from InsertService, get the first child
	local actualModel = model
	if model:IsA("Model") and model.Name == "InsertedObjects" then
		local children = model:GetChildren()
		if #children > 0 then
			actualModel = children[1]
		end
	end

	local quarantined, scriptInventory, disabledScriptCount = pcall(quarantineImportedScripts, actualModel)
	if not quarantined then
		model:Destroy()
		error(scriptInventory)
	end

	local validName, nameError = validateAddressableName(actualModel.Name)
	if not validName then
		model:Destroy()
		error(nameError)
	end
	local uniqueName, uniqueError = pcall(assertUniqueChildName, parent, actualModel.Name)
	if not uniqueName then
		model:Destroy()
		error(uniqueError)
	end
	actualModel.Parent = parent
	if model ~= actualModel then
		model:Destroy()
	end

	return {
		success = true,
		path = getInstancePath(actualModel),
		name = actualModel.Name,
		scripts = scriptInventory,
		scriptsQuarantined = disabledScriptCount,
	}
end

-- Paths that modify the game and should create undo waypoints
local modifyingPaths = {
	["/script/set"] = true,
	["/script/edit"] = true,
	["/instance/set"] = true,
	["/instance/create"] = true,
	["/instance/delete"] = true,
	["/instance/clone"] = true,
	["/instance/move"] = true,
	["/instance/bulk-create"] = true,
	["/instance/bulk-delete"] = true,
	["/instance/bulk-set"] = true,
	["/code/run"] = true,
	["/game/install"] = true,
	["/game/remove"] = true,
	["/asset/insert"] = true,
}

-- Friendly names for activity log
local actionNames = {
	["/ping"] = "Ping",
	["/playtest/state"] = "Get Playtest State",
	["/playtest/logs"] = "Get Recent Logs",
	["/script/get"] = "Read Script",
	["/script/set"] = "Write Script",
	["/script/edit"] = "Edit Script",
	["/instance/children"] = "List Children",
	["/instance/properties"] = "Get Properties",
	["/instance/set"] = "Set Property",
	["/instance/create"] = "Create Instance",
	["/instance/delete"] = "Delete Instance",
	["/instance/clone"] = "Clone Instance",
	["/instance/move"] = "Move Instance",
	["/instance/bulk-create"] = "Bulk Create",
	["/instance/bulk-delete"] = "Bulk Delete",
	["/instance/bulk-set"] = "Bulk Update",
	["/instance/search"] = "Search",
	["/selection/get"] = "Get Selection",
	["/code/run"] = "Run Code",
	["/game/snapshot"] = "Inspect Starter Game",
	["/game/install"] = "Generate Starter Game",
	["/game/verify"] = "Verify Starter Game",
	["/game/remove"] = "Remove Generated Game",
	["/asset/insert"] = "Insert Asset",
}

-- HTTP request handler
local function handleRequest(request)
	local path = request.path or request.Path
	local body = request.body or request.Body

	if type(path) ~= "string" or path == "" then
		return {
			status = 400,
			body = jsonEncode({ error = "Request path must be a non-empty string" })
		}
	end

	local handler = handlers[path]
	if not handler then
		return {
			status = 404,
			body = jsonEncode({ error = "Not found: " .. path })
		}
	end
	
	local data = {}
	if body and body ~= "" then
		local success, parsed = pcall(jsonDecode, body)
		if not success or type(parsed) ~= "table" then
			return {
				status = 400,
				body = jsonEncode({ error = "Request body must be valid JSON" })
			}
		end
		data = parsed
	end
	
	-- Create undo waypoint for modifying operations
	local isModifying = modifyingPaths[path]
	if isModifying and not RunService:IsEdit() then
		return {
			status = 409,
			body = jsonEncode({
				error = "Press Stop in Roblox Studio before making changes. Playtest changes are discarded when testing ends.",
			})
		}
	end
	if isModifying then
		ChangeHistoryService:SetWaypoint("bubbertron9001: " .. path)
	end
	
	-- Set processing state
	isProcessing = true
	updateUI()
	
	local success, result = pcall(handler, data)
	
	-- Update activity log
	local actionName = actionNames[path] or path
	if success then
		addActivity(actionName, "success")
	else
		addActivity(actionName, "error", tostring(result))
	end
	
	isProcessing = false
	updateUI()
	
	if not success then
		return {
			status = 500,
			body = jsonEncode({ error = tostring(result) })
		}
	end
	
	-- Commit the change so it can be undone
	if isModifying then
		ChangeHistoryService:SetWaypoint("bubbertron9001: " .. path .. " (done)")
	end
	
	return {
		status = 200,
		body = jsonEncode(result)
	}
end

local function rememberCompletedRequest(requestId, result)
	if completedRequests[requestId] == nil then
		table.insert(completedRequestOrder, requestId)
	end
	completedRequests[requestId] = result

	while #completedRequestOrder > MAX_COMPLETED_REQUESTS do
		local oldestId = table.remove(completedRequestOrder, 1)
		completedRequests[oldestId] = nil
	end
end

local function sendResponse(requestId, result)
	local encodedBody = jsonEncode({
		id = requestId,
		session_id = SESSION_ID,
		response = result,
	})

	for attempt = 1, 3 do
		local success, response = pcall(function()
			return HttpService:RequestAsync({
				Url = RESPOND_URL,
				Method = "POST",
				Headers = {
					["Content-Type"] = "application/json",
					["X-bubbertron9001-Secret"] = PAIRING_SECRET,
				},
				Body = encodedBody,
			})
		end)

		if success and response.Success then
			return true
		end

		if attempt < 3 then
			task.wait(0.15 * attempt)
		end
	end

	return false
end

local function releaseSession()
	pcall(function()
		HttpService:RequestAsync({
			Url = DISCONNECT_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["X-bubbertron9001-Secret"] = PAIRING_SECRET,
			},
			Body = jsonEncode({ session_id = SESSION_ID }),
		})
	end)
end

-- Polling loop
local function pollServer()
	local failCount = 0
	local maxFails = 3
	local httpPermissionFailCount = 0

	while pollingEnabled do
		local success, response = pcall(function()
			return HttpService:RequestAsync({
				Url = POLL_SESSION_URL,
				Method = "GET",
				Headers = { ["X-bubbertron9001-Secret"] = PAIRING_SECRET },
			})
		end)

		local httpRequestsDisabled = not (success and response.Success)
			and isHttpRequestsDisabledError(
				getHttpFailureDetails(success, response)
			)
		if httpRequestsDisabled then
			httpPermissionFailCount = httpPermissionFailCount + 1
			if httpPermissionFailCount >= maxFails and not hasHttpError then
				hasHttpError = true
				hasPairingError = false
				hasSessionConflict = false
				isConnected = false
				isConnecting = true
				projectInfo = nil
				addActivity("Allow HTTP Requests", "error")
				updateUI()
			end
		elseif success and response.Success then
			httpPermissionFailCount = 0
			if hasHttpError then
				hasHttpError = false
				updateUI()
			end
		end

		if success and response.StatusCode == 401 then
			local decoded, data = pcall(jsonDecode, response.Body)
			if decoded and type(data) == "table" and data.pairing_error then
				if not hasPairingError then
					addActivity("Plugin pairing failed", "error")
					warn("[bubbertron9001-bridge] " .. (data.message or "Reinstall the Studio plugin"))
				end
				hasPairingError = true
				hasHttpError = false
				hasSessionConflict = false
				isConnected = false
				isConnecting = false
				projectInfo = nil
				updateUI()
				task.wait(0.5)
				continue
			end
		end

		if success and response.Success then
			local decoded, data = pcall(jsonDecode, response.Body)
			if not decoded or type(data) ~= "table" then
				failCount = failCount + 1
				warn("[bubbertron9001-bridge] Ignoring an invalid bridge response")
				task.wait(0.25)
				continue
			end

			hasPairingError = false

			if data.session_conflict then
				if not hasSessionConflict then
					addActivity("Another Studio is connected", "pending")
					warn("[bubbertron9001-bridge] " .. (data.message or "Another Studio session is active"))
				end
				hasSessionConflict = true
				isConnected = false
				isConnecting = false
				projectInfo = nil
				failCount = 0
				updateUI()
				task.wait(0.25)
				continue
			end

			if hasSessionConflict then
				hasSessionConflict = false
				addActivity("Studio session available", "success")
			end

			-- Connected as the active Studio session.
			if not isConnected then
				isConnected = true
				isConnecting = false
				failCount = 0
				updateUI()
				addActivity("Connected", "success")
				print("[bubbertron9001-bridge] Connected to bubbertron9001 Desktop")
			end

			if data.project then
				projectInfo = data.project
				updateUI()
			end

			if data.request then
				local requestId = data.id
				if type(requestId) ~= "string" or requestId == "" then
					warn("[bubbertron9001-bridge] Ignoring a request without a valid ID")
				elseif inFlightRequestIds[requestId] then
					warn("[bubbertron9001-bridge] Ignoring duplicate in-flight request " .. requestId)
				else
					local result = completedRequests[requestId]
					if result == nil then
						inFlightRequestIds[requestId] = true
						local handled, executionResult = pcall(handleRequest, data.request)
						inFlightRequestIds[requestId] = nil

						if handled then
							result = executionResult
						else
							result = {
								status = 500,
								body = jsonEncode({ error = tostring(executionResult) }),
							}
						end
						rememberCompletedRequest(requestId, result)
					end

					if not sendResponse(requestId, result) then
						warn("[bubbertron9001-bridge] Could not deliver response for " .. requestId)
					end
				end
			end
			failCount = 0
		else
			failCount = failCount + 1
			if isConnected and failCount >= maxFails then
				isConnected = false
				isConnecting = true
				hasSessionConflict = false
				projectInfo = nil
				updateUI()
				addActivity("Connection lost", "error")
				print("[bubbertron9001-bridge] Connection lost, retrying...")
			end
		end

		task.wait(0.1)
	end

	-- Stopped polling
	isConnected = false
	isConnecting = false
	hasSessionConflict = false
	hasPairingError = false
	hasHttpError = false
	projectInfo = nil
	updateUI()
end

-- Toggle connection
function toggleConnection()
	pollingEnabled = not pollingEnabled
	
	if pollingEnabled then
		isConnecting = true
		hasSessionConflict = false
		hasPairingError = false
		hasHttpError = false
		updateUI()
		addActivity("Connecting", "pending")
		print("[bubbertron9001-bridge] Connecting...")
		task.spawn(pollServer)
	else
		releaseSession()
		isConnected = false
		isConnecting = false
		hasSessionConflict = false
		hasPairingError = false
		hasHttpError = false
		projectInfo = nil
		updateUI()
		addActivity("Disconnected", "success")
		print("[bubbertron9001-bridge] Disconnected")
	end
end

-- Initialize
createWidget()
updateUI()

toggleButton.Click:Connect(toggleConnection)

-- Show widget when button clicked
toggleButton.Click:Connect(function()
	widget.Enabled = true
end)

plugin.Unloading:Connect(function()
	pollingEnabled = false
	if logMessageConnection then
		logMessageConnection:Disconnect()
		logMessageConnection = nil
	end
	releaseSession()
end)

print("[bubbertron9001-bridge] Plugin loaded - Click Connect to start")
