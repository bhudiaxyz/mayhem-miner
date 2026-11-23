"""
smoke — Playwright browser smoke test against `npm run preview` (http://localhost:5191/mayhem-miner/).

Usage: python scripts/smoke.py [out_dir]   (needs `pip install playwright` + `playwright install chromium`)

Checks, on desktop (1280 x 720), a portrait phone (412 x 860, touch) and a landscape phone
(860 x 412, touch):
  - boot reaches the main menu with every item on screen, and no page errors occur;
  - New game starts a run (How to play is dismissed on first run);
  - walking moves the miner, and holding jump leaves the ground;
  - pause opens and resumes; the touch buttons press and release.
Screenshots of every step are saved to out_dir (default: shots/). Software GL is slow, so every
check polls window.__game instead of sleeping for fixed times.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://localhost:5191/mayhem-miner/?tier=low"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "shots")
OUT.mkdir(exist_ok=True)


def run(p, name, viewport, touch):
    browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader"])
    ctx = browser.new_context(viewport=viewport, has_touch=touch, is_mobile=touch)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector("#boot.ready .menu-btn", timeout=120_000)
    page.wait_for_timeout(800)
    page.screenshot(path=OUT / f"{name}-menu.png")
    for b in page.query_selector_all(".ls-menu .menu-btn"):
        box = b.bounding_box()
        assert box and box["y"] >= 0 and box["y"] + box["height"] <= viewport["height"], f"{name}: menu item off screen"

    page.click(".ls-menu .menu-btn >> nth=0")
    if page.is_visible("#sheet.open"):
        page.screenshot(path=OUT / f"{name}-howto.png")
        page.click("#sheet .sheet-actions button")
    page.wait_for_function("window.__game && window.__game.phase === 'play'", timeout=30_000)
    page.wait_for_timeout(2600)
    x0 = page.evaluate("window.__game.miner.x")

    if touch:
        page.wait_for_selector("#t-stick .joystick", state="attached", timeout=10_000)
        box = page.locator("#t-stick").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + box["height"], cy, steps=4)
        page.wait_for_function(f"window.__game.miner.x > {x0} + 8", timeout=30_000)
        page.mouse.up()
        page.dispatch_event('#touch [data-k="jump"]', "pointerdown", {"pointerId": 2, "isPrimary": True})
        assert page.is_visible('#touch [data-k="jump"].on'), "jump button pressed"
        page.dispatch_event('#touch [data-k="jump"]', "pointerup", {"pointerId": 2, "isPrimary": True})
        assert not page.is_visible('#touch [data-k="jump"].on'), "jump button released"
    else:
        page.keyboard.down("ArrowRight")
        page.wait_for_function(f"window.__game.miner.x > {x0} + 8", timeout=30_000)
        page.keyboard.down("Space")
        page.wait_for_function("window.__game.miner.mode !== 'ground'", timeout=30_000)
        page.keyboard.up("Space")
        page.keyboard.up("ArrowRight")
    page.screenshot(path=OUT / f"{name}-play.png")

    if touch:
        page.dispatch_event("#t-pause", "pointerdown")
    else:
        page.keyboard.press("Escape")
    page.wait_for_selector("#pause.open", timeout=10_000)
    page.screenshot(path=OUT / f"{name}-pause.png")
    page.click("#pause nav button >> nth=0")
    page.wait_for_selector("#pause:not(.open)", state="attached", timeout=10_000)

    assert not errors, f"{name}: page errors: {errors}"
    browser.close()
    print(f"  {name}: ok")


with sync_playwright() as p:
    run(p, "desktop", {"width": 1280, "height": 720}, False)
    run(p, "phone", {"width": 412, "height": 860}, True)
    run(p, "landscape", {"width": 860, "height": 412}, True)
print("smoke: all passed")
