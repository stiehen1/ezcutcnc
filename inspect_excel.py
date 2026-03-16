import pandas as pd

try:
    df = pd.read_excel('attached_assets/sample_upload_-_partial_(250214)_1771098142626.xlsx')
    print("Columns found:")
    for col in df.columns:
        print(f"- {col}")
    print("\nFirst 5 rows:")
    print(df.head().to_string())
except Exception as e:
    print(f"Error reading excel: {e}")
