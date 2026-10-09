local M={}
local defaults={retries=3,timeout=1.5,verbose=false}
function M.new(options)
local self=setmetatable({},{__index=M})
self.options={}
for key,value in pairs(defaults) do self.options[key]=value end
for key,value in pairs(options or {}) do self.options[key]=value end
return self
end
function M:describe(prefix)
  local parts={}
    for key,value in pairs(self.options) do table.insert(parts,key..'='..tostring(value)) end
  table.sort(parts)
  return (prefix or 'config')..': '..table.concat(parts,', ')
end
print(M.new({verbose=true}):describe "settings")
return M
