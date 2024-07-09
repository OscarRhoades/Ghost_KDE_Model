import numpy as np
import scipy.stats as stats
import matplotlib.pyplot as plt
import pandas as pd
import re


def read_csv_process_time(file):
    df = pd.read_csv(file, header=None)
    df.columns = ['time', 'info', 'type']    
    df = df[df.iloc[:, 2] == 'access']
    
    df['time'] = pd.to_datetime(df['time'])

    return df


def get_base_url(url):
    
    pattern = r"^(https?://[^/]+)"
    match = re.match(pattern, url, re.IGNORECASE)
    
    if match:
        return match.group(1)
    else:
        return None

    
def sample_next_site(current_site, transition_matrix):
    
    probabilities = transition_matrix.loc[current_site]
    probabilities = probabilities / probabilities.sum()
    next_sites = probabilities.index
    next_site = np.random.choice(next_sites, p=probabilities)

    return next_site


def fit_weibull(data):
    
    shape, loc, scale = stats.weibull_min.fit(data, floc=0) 
    return shape, loc, scale


def weibull_random_variable(shape, loc, scale):
    
    return stats.weibull_min.rvs(shape, loc=loc, scale=scale)


def domain_change_times_for_website(website, data):
    
    domain_changes = data[data['change_type'] == 'domain_change'] 
    domain_changes['time_delta'] = domain_changes['time'].diff().dt.total_seconds().fillna(0)
    domain_changes['time_delta'] = domain_changes['time_delta'].shift(-1)
    domain_changes = domain_changes.dropna()
    domain_changes_df = domain_changes[domain_changes['info'] == website]
    domain_changes_time = list(domain_changes_df['time_delta'])
    return domain_changes_time


def create_domain_change_variables_dictionary(data):

    domain_change_dictionary = {}

    domain_names = data['info'].unique()

    for name in domain_names:
        domain_change_times = domain_change_times_for_website(name, data)
        shape, loc, scale = fit_weibull(domain_change_times)
        
        domain_change_dictionary[name] = (shape, loc, scale)
    
    return domain_change_dictionary


def route_change_times_for_website(website, data):
    # Create the deltas for all domains and all route changes
    route_change_data = data.copy()
    route_change_data['time_delta'] = route_change_data['time'].diff().dt.total_seconds().fillna(0)
    route_change_data['time_delta'] = route_change_data['time_delta'].shift(-1)
    
    # Getting all the domain changes and the route 
    route_changes_df = route_change_data[route_change_data['info'] == website].reset_index()
    
    # print(route_changes_df)
    
    past_row = []
    rows_to_filter = []
    for i, row in route_changes_df.iterrows():
        # print(i)
        if i > 0:
            if row['change_type'] == 'route_change' and past_row['change_type'] == 'domain_change':
                
                rows_to_filter.append(i - 1)
        past_row = row
    
    
    route_changes_df = route_changes_df.drop(rows_to_filter).reset_index(drop=True)
        
    return route_changes_df['time_delta']


def create_route_change_variables_dictionary(data):
    
    route_change_dictionary = {}

    domain_names = data['info'].unique()

    for name in domain_names:
        domain_change_times = domain_change_times_for_website(name, data)
        shape, loc, scale = fit_weibull(domain_change_times)
        
        route_change_dictionary[name] = (shape, loc, scale)
    
    return route_change_dictionary





def main():
    
    data = read_csv_process_time("action_data.csv")
    
    data["info"] = data["info"].apply(lambda x: get_base_url(x))
        
    past_site = ""

    change_type = []

    for i, row in data.iterrows():
        current_site = row['info']
        
        if current_site != past_site:
            change_type.append("domain_change")
        else:
            change_type.append("route_change")
        
        past_site = current_site


    data['change_type'] = change_type

    data['time_delta'] = data['time'].diff().dt.total_seconds().fillna(0)

    domain_names = data['info'].unique()

    transition_matrix = pd.DataFrame(index=domain_names, columns=domain_names)

    transition_matrix = transition_matrix.fillna(0)

    domain_changes = data[data['change_type'] == 'domain_change'] 

    past_row = ""

    for i, row in domain_changes.iterrows():
        current_row = row['info']
        
        # Let the loop get both a past and current site, before it adds to the transition matrix
        if i > 0:
            transition_matrix.loc[current_row, past_row] += 1
        
        past_row = current_row
        
        
        
    # Hazard Model
    
    domain_change_dictionary = create_domain_change_variables_dictionary(data)
    route_change_dictionary = create_route_change_variables_dictionary(data)

    i = 0
    website = "HTTPS://WWW.GOOGLE.COM"

    while i < 10: 


        shape, loc, scale = domain_change_dictionary[website]
        website_visit_duration = weibull_random_variable(shape, loc, scale)
        print(f'website: {website} duration: {website_visit_duration}')
        
        
        r_shape, r_loc, r_scale = route_change_dictionary[website]
        
        cumulative_route_change_time = 0
        
        while True:
            
            route_change = weibull_random_variable(r_shape, r_loc, r_scale)
            
            if cumulative_route_change_time + route_change < website_visit_duration:
                print(f'website: {website} route_duration: {route_change}')
                
                cumulative_route_change_time += route_change
            else: 
                break
            
        website = sample_next_site(website, transition_matrix)
        i += 1
        

main()