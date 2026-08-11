#!/usr/bin/env python3
"""
Move every receipt-documents object under `<user_id>/` and rewrite
receipts.file_url to match.

Why this exists: three upload conventions have coexisted (iOS-signed-in
`<uid>/<file>`, iOS-anon `<file>`, web app `<rand>-<file>`), and in practice
every object today sits at a flat path. multiuser-05-storage.sql keys its
policies off the first path segment being the owner's uuid, so any object left
flat becomes unreachable the moment those policies apply.

file_url is rewritten to the bare object path (`<uid>/<file>`) rather than a
`/object/public/...` URL, because the bucket becomes private and those URLs stop
resolving. Clients derive a signed URL from the path at display time.

RUN THIS BEFORE multiuser-04-rls.sql. It uses the publishable key, which still
has full access until the RLS cutover. Afterwards it would need service_role.

Usage:
    python3 migrate-storage-paths.py <owner_user_id>            # dry run
    python3 migrate-storage-paths.py <owner_user_id> --apply    # do it

Env overrides: SUPABASE_URL, SUPABASE_KEY
"""

import json
import os
import sys
import urllib.error
import urllib.request

URL = os.environ.get("SUPABASE_URL", "https://lxxetltpuuwjtxmeemhx.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_7jF_NW4pRe8y6T-mFrLtew_9VtCke9e")
BUCKET = "receipt-documents"


def request(method, path, body=None, extra_headers=None):
    headers = {
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
    }
    headers.update(extra_headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def list_objects():
    status, rows = request(
        "POST",
        f"/storage/v1/object/list/{BUCKET}",
        {"prefix": "", "limit": 1000, "sortBy": {"column": "name", "order": "asc"}},
    )
    if status != 200:
        sys.exit(f"Could not list objects: HTTP {status} {rows}")
    # entries without an id are pseudo-folders, not real objects
    return [r["name"] for r in rows if r.get("id")]


def object_path_from_file_url(file_url):
    marker = f"/{BUCKET}/"
    if marker in file_url:
        return file_url.split(marker, 1)[1]
    return file_url  # already a bare path


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply_changes = "--apply" in sys.argv
    # receipts is now authenticated-only, so the publishable key this script uses
    # can move objects but can no longer rewrite file_url. Pass --skip-db and do
    # that half in SQL, where each row's own user_id drives its new path.
    skip_db = "--skip-db" in sys.argv
    if len(args) != 1:
        sys.exit(__doc__)
    owner = args[0]
    if owner.count("-") != 4:
        sys.exit(f"'{owner}' does not look like a user uuid")

    names = list_objects()
    flat = [n for n in names if "/" not in n]
    nested = [n for n in names if "/" in n]

    print(f"bucket {BUCKET}: {len(names)} objects "
          f"({len(flat)} flat to move, {len(nested)} already namespaced)")
    if not apply_changes:
        print("\n*** DRY RUN — re-run with --apply to make changes ***\n")

    # 1. Move objects
    moved = {}
    for name in flat:
        dest = f"{owner}/{name}"
        print(f"  move  {name}\n     -> {dest}")
        if apply_changes:
            status, body = request(
                "POST",
                "/storage/v1/object/move",
                {"bucketId": BUCKET, "sourceKey": name, "destinationKey": dest},
            )
            if status not in (200, 201):
                print(f"     !! FAILED HTTP {status} {body}")
                continue
        moved[name] = dest

    # 2. Rewrite receipts.file_url
    if skip_db:
        print("\n--skip-db: leaving receipts.file_url to the SQL step")
        print("\nDone." if apply_changes else "\nDry run complete.")
        return
    status, receipts = request("GET", "/rest/v1/receipts?select=id,file_url&file_url=not.is.null")
    if status != 200:
        sys.exit(f"Could not read receipts: HTTP {status} {receipts}")

    print(f"\n{len(receipts)} receipts reference a file")
    for r in receipts:
        old_path = object_path_from_file_url(r["file_url"])
        new_path = moved.get(old_path, old_path if "/" in old_path else None)
        if new_path is None:
            print(f"  ?? receipt {r['id']}: '{old_path}' has no matching object — left alone")
            continue
        if new_path == r["file_url"]:
            continue
        print(f"  set   receipt {r['id']} file_url -> {new_path}")
        if apply_changes:
            status, body = request(
                "PATCH",
                f"/rest/v1/receipts?id=eq.{r['id']}",
                {"file_url": new_path},
                {"Prefer": "return=minimal"},
            )
            if status not in (200, 204):
                print(f"     !! FAILED HTTP {status} {body}")

    orphans = sorted(set(moved.values()) - {
        f"{owner}/{object_path_from_file_url(r['file_url'])}" for r in receipts
    } - {object_path_from_file_url(r["file_url"]) for r in receipts})
    if orphans:
        print(f"\n{len(orphans)} moved object(s) are not referenced by any receipt "
              f"(leftovers from deleted receipts). Harmless; delete manually if you want:")
        for o in orphans:
            print(f"  {o}")

    print("\nDone." if apply_changes else "\nDry run complete.")


if __name__ == "__main__":
    main()
