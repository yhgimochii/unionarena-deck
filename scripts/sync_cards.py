import json, re, time
from pathlib import Path
from urllib.parse import quote, urljoin
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "cards.json"
RUGIA = "https://rugiacreation.com/ua/search"
OFFICIAL = "https://www.unionarena-tcg.com/en/cardlist/detail_iframe.php?card_no="
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; UA-Deck-Analyzer/5.0)"}

try:
    cards = {x["id"]: x for x in json.loads(OUT.read_text(encoding="utf-8")) if isinstance(x, dict) and x.get("id")}
except Exception:
    cards = {}

# Card IDs seen on Rugia/official pages. This deliberately accepts future sets too.
CARD_RE = re.compile(r"(?:[A-Z0-9]+(?:BT|ST|DC|PR|EX|PC)?|UAPR)/([A-Z0-9]+-\d+-\d{3}|[A-Z0-9]+-\d+-AP\d{2})", re.I)
FULL_ID_RE = re.compile(r"^([A-Z0-9]+(?:BT|ST|DC|PR|EX|PC)?|UAPR)/([A-Z0-9]+-\d+-\d{3}|[A-Z0-9]+-\d+-AP\d{2})$", re.I)
RARITY_RE = re.compile(r"\((?:SR|UR|SP|PcSR|PcR|PcC|R|U|C|AP|PR)(?:★+)?\)")
VERSION_RE = re.compile(r"(?:[?&]Version=|/)([A-Z][A-Z0-9]{1,12})(?:[&#\"']|$)", re.I)

# Known Rugia version codes as a fallback. Discovery from the site's filter/options is primary,
# so newly added IPs can be picked up without editing this list.
FALLBACK_VERSIONS = {
    "AOT","BLC","NIK","IMSC","IMSH","KRM","ARK","WBK","MCR","FMA","KNN",
    "REZ","RNK","MON","SMD","EVA","TLR","KGB","TGH","KNG","SCL","IYS",
    "EIS","CSM","MUS","CGD","GGL","MHA","JJK","HUN","DS","GNT","YYS",
    "DGM","BLU","STN","SHY","SYN","DRS","OPM","BLA","KMR","GMR","HIK",
    "BTL","GAM","UMI","SLA","GGS","KAI","SBR","100K"
}


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


def normalize_version(v):
    return clean(v).upper().strip()


def discover_versions(session, seed_html=None):
    html = seed_html
    if html is None:
        r = session.get(RUGIA, params={"Name": "HK"}, headers=HEADERS, timeout=45)
        r.raise_for_status()
        html = r.text

    soup = BeautifulSoup(html, "html.parser")
    versions = set()

    # 1) Version dropdown/options — best source for the site's supported IP codes.
    for opt in soup.find_all("option"):
        value = normalize_version(opt.get("value", ""))
        label = clean(opt.get_text(" ", strip=True))
        if value and value not in {"ALL", "0", "NONE", "SELECT"} and re.fullmatch(r"[A-Z][A-Z0-9]{1,12}", value):
            if value not in {"HK", "JP", "EN", "TC", "SC"}:
                versions.add(value)
        m = re.search(r"〖([A-Z0-9]+)〗", label)
        if m:
            versions.add(m.group(1).upper())

    # 2) Any Version= links on the page.
    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        for m in re.finditer(r"[?&]Version=([^&#\"']+)", href, re.I):
            v = normalize_version(m.group(1))
            if re.fullmatch(r"[A-Z][A-Z0-9]{1,12}", v):
                versions.add(v)

    # 3) Fallback list so current known IPs are guaranteed to be queried even if Rugia's
    # dropdown is rendered dynamically and therefore absent from the server HTML.
    versions.update(FALLBACK_VERSIONS)
    return sorted(versions)


def header_cards_from_text(soup):
    """Parse Rugia result pages from visible text, not DOM link structure.

    This is important because Rugia uses different link markup between IP pages.
    """
    lines = []
    for raw in soup.get_text("\n", strip=True).splitlines():
        x = clean(raw)
        if x and x.lower() != "image":
            lines.append(x)

    headers = []
    for i, line in enumerate(lines):
        # e.g. UA43BT/SMD-1-042 (C), UAPR/SMD-1-022 (C), EX15BT/BLC-4-004 (SR)
        m = re.match(r"^([A-Z0-9]+/[A-Z0-9]+-\d+-\d{3}(?:-[A-Z0-9]+)?)[ ]*\(([^)]+)\)$", line, re.I)
        if not m:
            # AP cards may omit a normal rarity suffix.
            m2 = re.match(r"^([A-Z0-9]+/[A-Z0-9]+-\d+-AP\d{2})(?:[ ]*\(([^)]+)\))?$", line, re.I)
            if m2:
                headers.append((i, m2.group(1).upper(), m2.group(2) or ""))
            continue
        headers.append((i, m.group(1).upper(), m.group(2)))

    out = []
    for n, (idx, cid, rarity) in enumerate(headers):
        end = headers[n + 1][0] if n + 1 < len(headers) else len(lines)
        block = lines[idx + 1:end]
        if not block:
            continue
        # First non-control line after the header is normally the card name.
        name = ""
        name_idx = -1
        for j, line in enumerate(block[:8]):
            if line in {"Image", "Title", "Card", "Trigger", "Effect"}:
                continue
            if line.startswith("特徵：") or line in {"特徵:", "Trait"}:
                continue
            if re.fullmatch(r"(?:[A-Z0-9]+/[A-Z0-9-]+)", line):
                continue
            name = line
            name_idx = j
            break
        if not name:
            name = cid.split("/")[-1]
            name_idx = 0

        content = block[name_idx + 1:] if name_idx >= 0 else block
        # Remove obvious page/UI noise but keep the actual translated rules text.
        filtered = []
        for line in content:
            if line in {"Image", "CARDLIST", "首頁", "上一頁", "下一頁"}:
                continue
            if line.startswith("UA") and "/" in line:
                break
            if line.startswith("EX") and "/" in line:
                break
            if line.startswith("UAPR/"):
                break
            if line.startswith("特徵：") and not filtered:
                filtered.append(line)
            elif line:
                filtered.append(line)

        # Rugia search pages may show a trait immediately after the name and then effect text.
        # Keep it all in effect; the app can separately display traits when present in data.
        effect = "\n".join(filtered[:60]).strip()
        out.append({"id": cid, "name": name, "rarity": rarity, "effect": effect})
    return out


def parse_rugia(html, version=""):
    soup = BeautifulSoup(html, "html.parser")
    found = {}
    for row in header_cards_from_text(soup):
        cid = row["id"]
        # Only accept real card IDs, not random UI text.
        if not FULL_ID_RE.fullmatch(cid):
            continue
        found[cid] = {
            "id": cid,
            "name": row["name"],
            "rarity": row["rarity"],
            "effect": row["effect"],
            "url": f"{RUGIA}?Name=HK&Find1={quote(cid.split('/',1)[1])}",
            "source": "Rugia sync",
        }
    return list(found.values())


def parse_official(cid, html):
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)
    imgs = [clean(i.get("alt", "")) for i in soup.find_all("img") if i.get("alt")]
    out = {}

    # Energy may be rendered as an image alt such as "Purple-" instead of plain text.
    m = re.search(r"Required\s*Energy\s*\n(?:Image:\s*)?([A-Za-z]+)?-?\s*(\d+)", text, re.I)
    if m:
        out["energyColor"] = (m.group(1) or "").capitalize()
        out["energy"] = int(m.group(2))
    else:
        for alt in imgs:
            mm = re.fullmatch(r"(Red|Blue|Yellow|Green|Purple)-?(\d+)?", alt, re.I)
            if mm and mm.group(2):
                out["energyColor"] = mm.group(1).capitalize()
                out["energy"] = int(mm.group(2))
                break

    m = re.search(r"Consumed\s*AP\s*\n\s*(\d+)", text, re.I)
    if m:
        out["ap"] = int(m.group(1))

    m = re.search(r"Card\s*Type\s*\n\s*(Character|Site|Event|Action Point)", text, re.I)
    if m:
        out["type"] = {"Character":"角色", "Site":"場域", "Event":"事件", "Action Point":"AP"}.get(m.group(1), m.group(1))

    m = re.search(r"\nBP\s*\n\s*(\d+)\s*\n", text, re.I)
    if m:
        out["bp"] = int(m.group(1))

    m = re.search(r"Trait\s*\n\s*([^\n]+)", text, re.I)
    if m:
        t = clean(m.group(1))
        if t and t not in {"-", "None"}:
            out["traits"] = [t]

    m = re.search(r"Trigger\s*\n\s*([^\n]+)", text, re.I)
    if m:
        trig = clean(m.group(1))
        if trig and trig not in {"-", "None"}:
            out["trigger"] = trig
    return out


def enrich(cid, row, session):
    try:
        url = OFFICIAL + quote(cid, safe="")
        r = session.get(url, headers=HEADERS, timeout=20)
        if r.ok:
            meta = parse_official(cid, r.text)
            for k, v in meta.items():
                if v not in (None, "", []):
                    row[k] = v
    except Exception as e:
        print(f"WARN official {cid}: {e}")
    return row


def main():
    s = requests.Session()
    s.headers.update(HEADERS)

    base = s.get(RUGIA, params={"Name": "HK"}, timeout=45)
    base.raise_for_status()
    versions = discover_versions(s, base.text)
    print(f"Discovered {len(versions)} Rugia version/IP codes")
    print("Versions:", ", ".join(versions))

    discovered = {}
    for idx, version in enumerate(versions, 1):
        try:
            r = s.get(RUGIA, params={"Name": "HK", "Version": version}, timeout=45)
            if not r.ok:
                print(f"WARN {version}: HTTP {r.status_code}")
                continue
            rows = parse_rugia(r.text, version)
            print(f"[{idx}/{len(versions)}] {version}: {len(rows)} cards")
            for row in rows:
                discovered[row["id"]] = row
        except Exception as e:
            print(f"WARN {version}: {e}")

    # Also parse the generic all-card page; it can contain promos or newly added entries
    # that aren't exposed through a Version filter yet.
    try:
        rows = parse_rugia(base.text)
        print(f"Generic Rugia page: {len(rows)} cards")
        for row in rows:
            discovered[row["id"]] = row
    except Exception as e:
        print(f"WARN generic Rugia page: {e}")

    print(f"Total Rugia cards discovered: {len(discovered)}")

    # Merge Rugia data while preserving existing structured values when the source lacks them.
    for cid, row in discovered.items():
        old = cards.get(cid, {})
        merged = dict(old)
        merged.update({k: v for k, v in row.items() if v not in ("", None, [])})
        cards[cid] = merged

    # Enrich only newly discovered cards or cards missing core structured fields. This keeps
    # the weekly workflow reasonably fast while still filling gaps.
    todo = []
    for cid in discovered:
        d = cards[cid]
        if any(k not in d for k in ("energy", "ap", "type")) or (d.get("type") == "角色" and "bp" not in d):
            todo.append(cid)
    print(f"Official metadata to fetch: {len(todo)} cards")

    for i, cid in enumerate(todo, 1):
        cards[cid] = enrich(cid, cards[cid], s)
        if i % 25 == 0:
            print(f"Enriched {i}/{len(todo)}")
        time.sleep(0.05)

    OUT.write_text(
        json.dumps(sorted(cards.values(), key=lambda x: x["id"]), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(cards)} cards to {OUT}")

if __name__ == "__main__":
    main()
