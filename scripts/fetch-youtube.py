#!/usr/bin/env python3
"""Write data/videos.json from the 5H4N3 YouTube feeds.

The homepage reads that file. A playlist that fails to download keeps its
previous list. If the channel feed fails, the file is left as it was.
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "videos.json"

FEEDS = {
    "channel": "https://www.youtube.com/feeds/videos.xml?channel_id=UCczT8ztFCxrtSW2o4IMtnLA",
    "deck": "https://www.youtube.com/feeds/videos.xml?playlist_id=PLM-vmTqa9sIM",
    "showdown": "https://www.youtube.com/feeds/videos.xml?playlist_id=PLNaF8h_Wo--k",
    "diver": "https://www.youtube.com/feeds/videos.xml?playlist_id=PLDYcnPDhDsqQ",
    "market": "https://www.youtube.com/feeds/videos.xml?playlist_id=PLeITrMF2f0UY",
    "precon": "https://www.youtube.com/feeds/videos.xml?playlist_id=PLdrI5I3i0inc",
    "pack": "https://www.youtube.com/feeds/videos.xml?playlist_id=PLGyYSFJhrQBQ",
}
ORDER = list(FEEDS)
ATOM = "http://www.w3.org/2005/Atom"
YT = "http://www.youtube.com/xml/schemas/2015"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MST = timezone(timedelta(hours=-7))


def kind_of(title):
    if re.search(r"pack opening", title, re.I):
        return "pack"
    if re.search(r"cyber showdown", title, re.I):
        return "showdown"
    if re.search(r"deck tech", title, re.I):
        return "deck"
    if re.search(r"deep diver", title, re.I):
        return "diver"
    if re.search(r"asset appreciation|market report", title, re.I):
        return "market"
    if re.search(r"precon", title, re.I):
        return "precon"
    if re.search(r"breaking news", title, re.I):
        return "news"
    return "upload"


def episode(title):
    match = re.search(r"Ep\.?\s*(\d+)", title, re.I)
    return match.group(1) if match else ""


def clean_matchup(title):
    parts = title.split("|")
    tail = parts[-1].strip() if len(parts) > 1 else title.strip()
    tail = re.sub(r"#\S+", "", tail)
    tail = re.sub(r"v\.s\.", "vs", tail, flags=re.I)
    tail = re.sub(r"\s+REMATCH", " rematch", tail, flags=re.I)
    tail = re.sub(r"\s+ft\.\s+", " · ", tail, count=1, flags=re.I)
    return re.sub(r"\s+", " ", tail).strip()


def present(title, video_id, published):
    kind = kind_of(title)
    ep = episode(title)
    ep_short = f"Ep.{ep}" if ep else ""
    ep_spec = f"Ep. {ep.zfill(2)}" if ep else ""
    view = {
        "kicker": "Latest",
        "heading": "New upload",
        "subhead": title,
        "detail": "",
        "line": title,
        "specValue": "New",
        "specDetail": title,
    }
    if kind == "showdown":
        matchup = clean_matchup(title)
        versus = matchup.split(" · ")[0]
        view = {
            "kicker": "Match",
            "heading": "Cyber Showdown",
            "subhead": ep_short or "Match",
            "detail": matchup,
            "line": f"{ep_short} · {versus}" if ep_short else versus,
            "specValue": ep_spec or "Match",
            "specDetail": matchup,
        }
    elif kind == "deck":
        name = re.sub(r"^.*?deck tech\s*[|\-–]\s*", "", title, count=1, flags=re.I)
        name = re.sub(r"\s*#\S+", "", name).strip()
        build = re.search(r"\(([^)]+)\)", name)
        view = {
            "kicker": "Deck tech",
            "heading": "Deck Tech",
            "subhead": name,
            "detail": "Full walkthrough.",
            "line": name,
            "specValue": name.split("(")[0].strip(),
            "specDetail": "Newest deck tech" + (f" · {build.group(1)} build" if build else ""),
        }
    elif kind == "market":
        dates = re.search(r"(\d{1,2}/\d{1,2})/\d{4}\s*-\s*(\d{1,2}/\d{1,2})/\d{4}", title)
        window = f"{dates.group(1)} – {dates.group(2)}" if dates else "This week"
        view = {
            "kicker": "Market",
            "heading": "Asset Appreciation",
            "subhead": window,
            "detail": "What moved this week, and what sat still.",
            "line": window,
            "specValue": window,
            "specDetail": "Weekly price report",
        }
    elif kind == "diver":
        topic = " - ".join(re.split(r"\s+-\s+", title)[1:]).strip()
        view = {
            "kicker": "Deep Diver",
            "heading": "Deep Diver",
            "subhead": ep_short or "Episode",
            "detail": topic,
            "line": f"{ep_short} · {topic}" if ep_short and topic else (ep_short or topic),
            "specValue": ep_spec or "Deep Diver",
            "specDetail": topic,
        }
    elif kind == "pack":
        num = re.search(r"\|\s*(\d+)", title)
        label = f"#{num.group(1)}" if num else "Pack"
        view = {
            "kicker": "Packs",
            "heading": "Genesis Unlimited",
            "subhead": label,
            "detail": "Opening on camera.",
            "line": label,
            "specValue": label,
            "specDetail": "Genesis Unlimited opening",
        }
    elif kind == "precon":
        precon = title.split("|")[-1].strip()
        view = {
            "kicker": "Precon",
            "heading": "Precon Upgrade",
            "subhead": precon,
            "detail": "Starter deck, opened up.",
            "line": precon,
            "specValue": precon,
            "specDetail": "Precon upgrade",
        }
    elif kind == "news":
        news = re.sub(r"\s+-\s+Neuroscape Breaking News!?\s*$", "", title, count=1, flags=re.I).strip()
        view = {
            "kicker": "News",
            "heading": "Breaking",
            "subhead": news,
            "detail": "Neuroscape breaking news.",
            "line": news,
            "specValue": "News",
            "specDetail": news,
        }
    when = ""
    if published is not None:
        local = published.astimezone(MST)
        when = f"{MONTHS[local.month - 1]} {local.day}"
    return {
        "id": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "thumb": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "when": when,
        "kind": kind,
        "view": view,
    }


def child_text(entry, namespace, tag):
    node = entry.find(f"{{{namespace}}}{tag}")
    return (node.text or "").strip() if node is not None and node.text else ""


def parse_feed(xml_bytes):
    root = ElementTree.fromstring(xml_bytes)
    videos = []
    for entry in root.findall(f"{{{ATOM}}}entry"):
        video_id = child_text(entry, YT, "videoId")
        title = child_text(entry, ATOM, "title")
        if not video_id or not title:
            continue
        published = None
        stamp = child_text(entry, ATOM, "published")
        if stamp:
            published = datetime.fromisoformat(stamp)
        videos.append(present(title, video_id, published))
    return videos


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "shanecookofficial-feed"})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}")
        return response.read()


def load_previous():
    if not OUT.exists():
        return {key: [] for key in ORDER}
    try:
        data = json.loads(OUT.read_text())
    except (OSError, json.JSONDecodeError):
        return {key: [] for key in ORDER}
    return {key: data.get(key) or [] for key in ORDER}


def main():
    current = load_previous()
    updated = dict(current)
    failures = []
    for key, url in FEEDS.items():
        try:
            videos = parse_feed(download(url))
        except Exception as error:
            failures.append(f"{key}: {error}")
            continue
        if not videos:
            failures.append(f"{key}: empty feed")
            continue
        updated[key] = videos
        print(f"{key}: {len(videos)} · {videos[0]['view']['line']}")
    if updated["channel"] == current["channel"] and "channel" in [item.split(":")[0] for item in failures]:
        print("Channel feed failed. Left data/videos.json unchanged.", file=sys.stderr)
        for line in failures:
            print(line, file=sys.stderr)
        return 1
    if not updated["channel"]:
        print("Channel feed was empty. Left data/videos.json unchanged.", file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {key: updated[key] for key in ORDER}
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    for line in failures:
        print(f"kept previous {line}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
