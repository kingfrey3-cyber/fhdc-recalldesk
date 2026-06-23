$cssPath = "app\globals.css"
$marker = "/* Assignment UI polish */"
$css = @'

/* Assignment UI polish */
.assignment-staff-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
}

.assignment-staff-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--fhdc-border, #d7e8f6);
  border-radius: 16px;
  background: #fff;
  font-weight: 800;
  color: var(--fhdc-blue-dark, #064a7a);
  cursor: pointer;
  min-height: 58px;
}

.assignment-staff-option input {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.assignment-staff-option.selected {
  border-color: var(--fhdc-orange, #ff7429);
  box-shadow: 0 12px 30px rgba(255, 116, 41, 0.16);
  background: #fff8f4;
}

button:disabled {
  opacity: 0.7;
  cursor: wait;
}
'@

if (!(Test-Path $cssPath)) {
  throw "Cannot find $cssPath. Run this from the fhdc-recalldesk project root."
}

$content = Get-Content $cssPath -Raw
if ($content -notlike "*$marker*") {
  Add-Content -Path $cssPath -Value $css
  Write-Host "Assignment UI CSS appended to app\globals.css"
} else {
  Write-Host "Assignment UI CSS already present. No change made."
}
