-- Place this Script in ServerScriptService, NOT in a LocalScript.
-- Enable Game Settings > Security > Allow HTTP Requests.
-- Keep the license key on the server. Do not replicate it to clients.
local HttpService = game:GetService("HttpService")

local AUTH_URL = "https://YOUR-DOMAIN.example"
local PROJECT_ID = "nyxaris-main"
local LICENSE_KEY = "PUT-YOUR-REDEEMED-LICENSE-KEY-HERE"

-- This identity binds the license to this Roblox experience.
-- It is not a physical-device fingerprint.
local EXPERIENCE_ID = tostring(game.GameId) .. ":" .. tostring(game.PlaceId)

local function post(path, body)
    local response = HttpService:RequestAsync({
        Url = AUTH_URL .. path,
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body = HttpService:JSONEncode(body)
    })
    if not response.Success then
        error("NYXARIS AUTH request failed: HTTP " .. tostring(response.StatusCode))
    end
    return HttpService:JSONDecode(response.Body)
end

local ok, result = pcall(function()
    return post("/api/auth/validate", {
        key = LICENSE_KEY,
        projectId = PROJECT_ID,
        hwid = EXPERIENCE_ID
    })
end)

if not ok or not result or result.valid ~= true then
    warn("NYXARIS AUTH: license validation failed. Experience features remain disabled.")
    return
end

print("NYXARIS AUTH: licensed for " .. tostring(result.username))
-- Start your own server-side licensed features below this line.
