function handler(event) {
    var request = event.request;
    var uri = request.uri;
    
    // Remove /api prefix for API Gateway requests
    if (uri.startsWith('/api/')) {
        request.uri = uri.substring(4); // Remove '/api'
    }
    
    return request;
}