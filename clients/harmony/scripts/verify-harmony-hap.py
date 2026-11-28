"""Inspect the actual HAP, not just its source or intermediate directory."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
package = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "harmony/entry/build/default/outputs/default/entry-default-unsigned.hap"
policy_bytes = (root / "harmony/security-policy.json").read_bytes()
with zipfile.ZipFile(package) as hap:
    assert hap.testzip() is None, "Damaged HAP archive"
    assert hap.read("resources/rawfile/security-policy.json") == policy_bytes, "Wrong packaged policy"
    module = json.loads(hap.read("module.json"))
    permissions = module["module"].get("requestPermissions", [])
    assert [permission["name"] for permission in permissions] == [
        "ohos.permission.INTERNET",
        "ohos.permission.PUBLISH_AGENT_REMINDER",
    ]
    assert module["app"]["minAPIVersion"] == 260000026, "Unexpected minimum API"
    assert module["app"]["targetAPIVersion"] == 260000026, "Unexpected target API"
    assert "ets/modules.abc" in hap.namelist(), "Missing native implementation"
    extensions = module["module"].get("extensionAbilities", [])
    assert any(
        extension["name"] == "ScheduleFormAbility" and extension["type"] == "form"
        for extension in extensions
    ), "Missing schedule form extension"
    forms = json.loads(hap.read("resources/base/profile/form_config.json"))["forms"]
    forms_by_name = {form["name"]: form for form in forms}
    for name in ["today_schedule", "exam_notice"]:
        assert {"2*2", "2*4"}.issubset(forms_by_name[name]["supportDimensions"]), f"Missing dimensions: {name}"
        assert forms_by_name[name]["standby"]["isPrivacySensitive"], f"Missing privacy setting: {name}"
    assert forms_by_name["today_schedule"]["isDefault"], "Missing default schedule form"
    pages = [name for name in hap.namelist() if name.startswith("resources/rawfile/www/") and name.endswith(".html")]
    assert pages, "No embedded web pages"
    assert "resources/rawfile/www/dashboard/me/settings/widgets/index.html" in pages, "Missing widget settings page"
    for name in pages:
        html = hap.read(name).decode("utf-8")
        assert 'http-equiv="Content-Security-Policy"' in html, name
        for rule in ["connect-src 'self' data: blob:", "form-action 'none'", "frame-src 'none'", "worker-src 'none'"]:
            assert rule in html, (name, rule)
    login = hap.read("resources/rawfile/www/login/index.html").decode("utf-8")
    assert 'name="ysu-platform" content="harmony"' in login, "Non-Harmony frontend"
    result = {
        "artifact": package.name,
        "sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
        "bytes": package.stat().st_size,
        "bundleName": module["app"]["bundleName"],
        "version": module["app"]["versionName"],
        "targetSystem": "HarmonyOS 7 / API 26",
        "permissions": [permission["name"] for permission in permissions],
        "protectedHtmlPages": len(pages),
        "reviewedRoutes": len(json.loads(policy_bytes)["routes"]),
        "policySha256": hashlib.sha256(policy_bytes).hexdigest(),
        "signature": "unsigned",
        "deviceLoginVerified": False,
        "deviceTrafficVerified": False,
    }
print(json.dumps(result, ensure_ascii=False, indent=2))
