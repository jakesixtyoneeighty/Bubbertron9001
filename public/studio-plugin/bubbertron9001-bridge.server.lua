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
