const t=`--!strict

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
`;export{t as default};
