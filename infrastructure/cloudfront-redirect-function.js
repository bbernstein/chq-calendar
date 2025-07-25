function handler(event) {
    var request = event.request;
    var headers = request.headers;
    var host = headers.host ? headers.host.value : '';
    
    // If the request is to the root domain (without www), redirect to www
    if (host === 'chqcal.org') {
        var response = {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                'location': { value: 'https://www.chqcal.org' + request.uri }
            }
        };
        
        // Preserve query string if present
        if (request.querystring && Object.keys(request.querystring).length > 0) {
            var queryString = [];
            for (var param in request.querystring) {
                if (request.querystring[param].multiValue) {
                    request.querystring[param].multiValue.forEach(function(val) {
                        if (val && val.value) {
                            queryString.push(encodeURIComponent(param) + '=' + encodeURIComponent(val.value));
                        }
                    });
                } else {
                    if (request.querystring[param].value !== undefined && request.querystring[param].value !== null) {
                        queryString.push(encodeURIComponent(param) + '=' + encodeURIComponent(request.querystring[param].value));
                    }
                }
            }
            response.headers.location.value += '?' + queryString.join('&');
        }
        
        return response;
    }
    
    return request;
}