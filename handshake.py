import sys
from supabase import create_client, Client

# Replace these with your live credentials from your Supabase Dashboard
SUPABASE_URL = "https://your-actual-id.supabase.co"
SUPABASE_KEY = "your-actual-anon-key"

def run_handshake():
    print("📡 Initiating connection handshake with Supabase...")
    
    try:
        # Initialize client instance
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        # 1. Test Write Access: Insert a temporary verification player
        print("✍️ Testing write permissions (Inserting 'Handshake_Bot')...")
        write_response = supabase.table("players").insert({"name": "Handshake_Bot"}).execute()
        
        # Check if the insert returned data successfully
        if not write_response.data:
            print("❌ Write returned an empty dataset. Check table RLS policies.")
            return
            
        print(f"✅ Write verified! Row created: {write_response.data}")
        
        # 2. Test Read Access: Query the player back out
        print("📖 Testing read permissions...")
        read_response = supabase.table("players").select("*").eq("name", "Handshake_Bot").execute()
        print(f"✅ Read verified! Retreived: {read_response.data}")
        
        # 3. Clean up: Delete the test bot so your production table stays pristine
        print("🧼 Cleaning up verification rows...")
        supabase.table("players").delete().eq("name", "Handshake_Bot").execute()
        
        print("\n🎉 [HANDSHAKE SUCCESS] Your Ubuntu WSL environment has full clearance!")
        
    except Exception as e:
        print("\n❌ Handshake Failed!")
        print(f"Error Details: {e}", file=sys.stderr)

if __name__ == "__main__":
    run_handshake()
