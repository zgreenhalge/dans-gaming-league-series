import csv
from supabase import create_client

# 1. Connect straight to your new database
url = "YOUR_SUPABASE_URL"
key = "YOUR_SUPABASE_ANON_KEY"
supabase = create_client(url, key)

# 2. Read your Season 3 CSV tracker file
with open('season3_tracker.csv', mode='r') as file:
    reader = csv.reader(file)
    for row in reader:
        # Look for rows containing your match data or byes
        if "Week" in row[11]:
            print(f"Found a schedule block: {row[11]}")
            # Use standard Python dicts to push data to Supabase
            # supabase.table("weeks").insert({"week_number": 1, ...}).execute()