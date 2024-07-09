import csv
import pandas as pd
import math
import re


def append_to_csv(file_path, new_row):
    try:
        with open(file_path, 'a', newline='') as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(new_row)
        print(f"Row added to {file_path}")
    except Exception as e:
        print(f"An error occurred: {e}")
        
        
        
def read_csv_process_time(file):
    df = pd.read_csv(file, header=None)
    df.columns = ['time', 'info', 'type']
    
    df['time'] = pd.to_datetime(df['time'])

    
    df['time_delta'] = df['time'].diff().dt.total_seconds().fillna(0)
    # print(df)
    return df





def get_base_url(url):
    # Regex pattern to match the base URL
    pattern = r"^(https?://[^/]+)"
    match = re.match(pattern, url, re.IGNORECASE)
    
    if match:
        return match.group(1)
    else:
        return None

 
def round_to_nearest_power_of_two(n):
    if n == 0:
        return 0
    
    # Calculate the exponent for the nearest powers of two
    log2_n = math.log2(n)
    lower_power = 2 ** math.floor(log2_n)
    upper_power = 2 ** math.ceil(log2_n)

    # Determine which power of two is closer to n
    if abs(n - lower_power) < abs(n - upper_power):
        return lower_power
    else:
        return upper_power
    

def create_action_list_with_variable_deltas():

    action_list = []

    df = read_csv_process_time('action_data.csv')
    for _, row in df.iterrows():
        action_list.append('t<' + str(round_to_nearest_power_of_two(row['time_delta'])) + '>')
        
        
        if row['type'] == "access":
            action_list.append(f"{row['type']} : {get_base_url(row['info'])}")
        else:
            action_list.append(f"{row['type']} : {row['info']}")
        
    
    
    for row in action_list:
        print(row)
        append_to_csv('action_tokens.csv', [row])
    
    return action_list   
        


# Example usage



create_action_list_with_variable_deltas()