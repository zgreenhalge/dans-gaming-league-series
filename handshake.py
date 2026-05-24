import os
import sys

# Defer supabase import so we can show a helpful message if the package isn't installed
SUPABASE_IMPORT_ERROR = None
create_client = None
Client = None
try:
    from supabase import create_client, Client  # type: ignore
except Exception as e:
    SUPABASE_IMPORT_ERROR = e

# Load .env file if present (python-dotenv) to simplify local dev
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    # python-dotenv not installed or .env missing; continue and rely on environment
    pass

# Read credentials from environment for safety
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_ANON_KEY")


def _resp_data(resp):
    """Normalize response objects/dicts from different supabase client versions."""
    if resp is None:
        return None
    if isinstance(resp, dict):
        return resp.get("data") or resp.get("result") or None
    return getattr(resp, "data", None) or getattr(resp, "result", None)


def _resp_error(resp):
    if resp is None:
        return None
    if isinstance(resp, dict):
        return resp.get("error")
    return getattr(resp, "error", None)


def run_handshake():
    print("📡 Initiating connection handshake with Supabase...")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ SUPABASE_URL and SUPABASE_KEY must be set in the environment.")
        print("Example (bash): export SUPABASE_URL=\"https://your-id.supabase.co\" && export SUPABASE_KEY=\"your-anon-or-service-key\"")
        sys.exit(2)

    try:
        # Initialize client instance
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

        # 0. Quick ping: try a lightweight select (no write) to ensure connectivity
        print("🔌 Testing connectivity with a lightweight SELECT on 'players' (limit 1)...")
        ping = supabase.table("players").select("id").limit(1).execute()
        ping_err = _resp_error(ping)
        if ping_err:
            print(f"❌ Connectivity test failed: {ping_err}")
            return

        print("✅ Connectivity OK.")

        # 1. Test Write Access: Insert a temporary verification player (returns data)
        print("✍️ Testing write permissions (Inserting 'Handshake_Bot')...")
        write_resp = supabase.table("players").insert({"name": "Handshake_Bot"}).select("*").execute()
        write_err = _resp_error(write_resp)
        write_data = _resp_data(write_resp)

        if write_err:
            print(f"❌ Write failed: {write_err}")
            return

        if not write_data:
            print("❌ Write returned no data. Check table RLS policies and API key permissions.")
            return

        print(f"✅ Write verified! Row created: {write_data}")

        # 2. Test Read Access: Query the player back out (by primary key if present)
        print("📖 Testing read permissions...")
        # try to extract id from returned data
        row_id = None
        if isinstance(write_data, list) and write_data:
            row_id = write_data[0].get("id")
        elif isinstance(write_data, dict):
            row_id = write_data.get("id")

        if row_id:
            read_resp = supabase.table("players").select("*").eq("id", row_id).execute()
        else:
            read_resp = supabase.table("players").select("*").eq("name", "Handshake_Bot").execute()

        read_err = _resp_error(read_resp)
        read_data = _resp_data(read_resp)

        if read_err:
            print(f"❌ Read failed: {read_err}")
            return

        print(f"✅ Read verified! Retrieved: {read_data}")

        # 3. Clean up: Delete the test bot
        print("🧼 Cleaning up verification rows...")
        if row_id:
            del_resp = supabase.table("players").delete().eq("id", row_id).execute()
        else:
            del_resp = supabase.table("players").delete().eq("name", "Handshake_Bot").execute()

        del_err = _resp_error(del_resp)
        if del_err:
            print(f"⚠️ Cleanup warning: failed to delete test row: {del_err}")
        else:
            print("✅ Cleanup complete.")

        print("\n🎉 [HANDSHAKE SUCCESS] Supabase connection and basic permissions verified.")

    except Exception as e:
        print("\n❌ Handshake Failed!")
        print(f"Error Details: {e}", file=sys.stderr)


def check_and_warn_venv():
    """Warn if no virtualenv is active and suggest activation or creation.

    Detects typical virtualenv activation and searches for common venv folders in the repo
    so users can quickly activate an existing environment.
    """
    active = (
        os.environ.get("VIRTUAL_ENV") is not None
        or getattr(sys, "real_prefix", None) is not None
        or getattr(sys, "base_prefix", None) != getattr(sys, "prefix", None)
    )
    if active:
        return

    cwd = os.path.dirname(__file__)
    candidates = []
    for name in (".venv", "venv", "env", ".env", "dgls-env"):
        p = os.path.join(cwd, name)
        if os.path.isdir(p):
            candidates.append(p)

    print("\n⚠️  Virtualenv not detected (no VIRTUAL_ENV or prefix mismatch).")
    if candidates:
        print("Found possible virtual environments in the repository:")
        for p in candidates:
            activate = os.path.join(p, "bin", "activate")
            print(f"  - {p}\n      Activate: source {activate}")
    else:
        print("No venv folders found. Create one with:")
        print("  python3 -m venv .venv && source .venv/bin/activate")
    print("Continuing the handshake script (may fail if required packages are missing).\n")


if __name__ == "__main__":
    check_and_warn_venv()
    run_handshake()
