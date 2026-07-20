const e=`--!strict

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
`;export{e as default};
