'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface FeedbackRecord {
  id: string;
  feedback: string;
  contactInfo?: string;
  timestamp: number;
  userAgent?: string;
  ipAddress?: string;
  createdAt: string;
  archived?: boolean;
  archivedAt?: string;
}

// Helper function to validate if a string is an email address
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper function to generate mailto URL
function generateMailtoUrl(email: string, timestamp: number, feedback: string): string {
  const subject = encodeURIComponent('chqcal feedback');
  const date = new Date(timestamp).toLocaleString();
  const body = encodeURIComponent(`\n\n${date}\n${feedback}`);
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

export default function FeedbackManagementPage() {
  const router = useRouter();
  const [feedbacks, setFeedbacks] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active');
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackRecord | null>(null);
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);

  useEffect(() => {
    // Check if running on localhost - bypass authentication for local development
    const isLocalhost = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    
    if (isLocalhost) {
      // Set dummy user for local development
      const dummyUser = { 
        email: 'dev@localhost.local', 
        name: 'Local Dev User' 
      };
      setUser(dummyUser);
      localStorage.setItem('chq_auth_user', JSON.stringify(dummyUser));
      localStorage.setItem('chq_auth_token', 'dummy-local-token');
      return;
    }
    
    // Production authentication check
    const token = localStorage.getItem('chq_auth_token');
    const userStr = localStorage.getItem('chq_auth_user');
    
    if (!token || !userStr) {
      router.push('/admin/login');
      return;
    }
    
    setUser(JSON.parse(userStr));
  }, [router]);

  // Admin endpoints now use CloudFront paths that route to admin Lambda
  // Local Express server has been removed - all environments use Lambda via CloudFront
  // Remove /api suffix if present since admin endpoints use /admin/api paths
  const baseApiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://www.chqcal.org/api';
  const apiUrl = baseApiUrl.replace(/\/api$/, '');

  // Helper function for authenticated API calls
  const authenticatedFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const isLocalhost = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    
    const token = localStorage.getItem('chq_auth_token');
    
    if (!token && !isLocalhost) {
      throw new Error('No authentication token found');
    }
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        // Use custom header to work around API Gateway Authorization header parsing issue
        ...(token && { 'X-Auth-Token': token }),
        // Temporarily disable Authorization header as it causes API Gateway to reject the request
        // before it reaches Lambda where our workaround code can handle it
        // 'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    if ((response.status === 401 || response.status === 403) && !isLocalhost) {
      // Token expired or invalid, redirect to login (but not on localhost)
      localStorage.removeItem('chq_auth_token');
      localStorage.removeItem('chq_auth_user');
      router.push('/admin/login');
      throw new Error('Authentication failed');
    }

    if (isLocalhost && (response.status === 401 || response.status === 403)) {
      // On localhost, log auth errors but don't fail completely
      console.warn('Auth error on localhost (this is expected in development):', response.status);
    }

    return response;
  }, [router]);

  const fetchFeedbacks = useCallback(async () => {
    try {
      setLoading(true);
      const response = await authenticatedFetch(`${apiUrl}/admin/api/feedback`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch feedback');
      }

      const data = await response.json();
      setFeedbacks(data.feedbacks || []);
    } catch (err) {
      console.error('Error fetching feedback:', err);
      setError('Failed to load feedback. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, authenticatedFetch]);

  useEffect(() => {
    if (user) {
      fetchFeedbacks();
    }
  }, [user, fetchFeedbacks]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const visibleIds = filteredFeedbacks.map(f => f.id);
      setSelectedIds(visibleIds);
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
    }
  };

  const handleArchive = async (id: string, archived: boolean) => {
    try {
      const response = await authenticatedFetch(`${apiUrl}/admin/api/feedback`, {
        method: 'PATCH',
        body: JSON.stringify({ id, archived }),
      });

      if (!response.ok) {
        throw new Error('Failed to update feedback');
      }

      // Refresh the list
      await fetchFeedbacks();
      setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
    } catch (err) {
      console.error('Error updating feedback:', err);
      setError('Failed to update feedback. Please try again.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this feedback?')) {
      return;
    }

    try {
      const response = await authenticatedFetch(`${apiUrl}/admin/api/feedback`, {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete feedback');
      }

      // Refresh the list
      await fetchFeedbacks();
      setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
    } catch (err) {
      console.error('Error deleting feedback:', err);
      setError('Failed to delete feedback. Please try again.');
    }
  };

  const handleBulkAction = async (action: 'archive' | 'delete', archived?: boolean) => {
    if (selectedIds.length === 0) {
      alert('Please select feedback items first.');
      return;
    }

    const actionText = action === 'delete' ? 'permanently delete' : 
                     (archived ? 'archive' : 'unarchive');
    
    if (!confirm(`Are you sure you want to ${actionText} ${selectedIds.length} feedback item(s)?`)) {
      return;
    }

    try {
      const response = await authenticatedFetch(`${apiUrl}/admin/api/feedback/bulk`, {
        method: 'PATCH',
        body: JSON.stringify({ ids: selectedIds, action, archived }),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} feedback`);
      }

      // Refresh the list and clear selection
      await fetchFeedbacks();
      setSelectedIds([]);
    } catch (err) {
      console.error(`Error in bulk ${action}:`, err);
      setError(`Failed to ${action} feedback. Please try again.`);
    }
  };

  const filteredFeedbacks = feedbacks.filter(feedback => {
    if (filter === 'active') return !feedback.archived;
    if (filter === 'archived') return feedback.archived;
    return true; // 'all'
  });

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <div className="text-lg text-gray-600 dark:text-gray-300 mt-4">
            {!user ? 'Authenticating...' : 'Loading feedback...'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center">
              <img
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar Logo"
                width={32}
                height={32}
                className="w-8 h-8 mr-3"
              />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                Feedback Management
              </h1>
            </div>
            <div className="flex items-center gap-4">
              {/* Development Mode Indicator */}
              {typeof window !== 'undefined' && 
                (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
                <div className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-md">
                  🔧 Development Mode
                </div>
              )}
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {filteredFeedbacks.length} feedback item(s)
              </div>
              {user && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    {user?.email}
                  </span>
                  <button
                    onClick={() => {
                      localStorage.removeItem('chq_auth_token');
                      localStorage.removeItem('chq_auth_user');
                      router.push('/admin/login');
                    }}
                    className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Controls */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            {/* Filter */}
            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                All ({feedbacks.length})
              </button>
              <button
                onClick={() => setFilter('active')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'active'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                Active ({feedbacks.filter(f => !f.archived).length})
              </button>
              <button
                onClick={() => setFilter('archived')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'archived'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                Archived ({feedbacks.filter(f => f.archived).length})
              </button>
            </div>

            {/* Bulk Actions */}
            {selectedIds.length > 0 && (
              <div className="flex gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-300 self-center">
                  {selectedIds.length} selected
                </span>
                <button
                  onClick={() => handleBulkAction('archive', true)}
                  className="px-3 py-1 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 text-sm"
                >
                  Archive
                </button>
                <button
                  onClick={() => handleBulkAction('archive', false)}
                  className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
                >
                  Unarchive
                </button>
                <button
                  onClick={() => handleBulkAction('delete')}
                  className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Feedback List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
          {filteredFeedbacks.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              No feedback found for the selected filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === filteredFeedbacks.length && filteredFeedbacks.length > 0}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Feedback
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Contact Info
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredFeedbacks.map((feedback) => (
                    <tr key={feedback.id} className={feedback.archived ? 'bg-gray-50 dark:bg-gray-700/50' : ''}>
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(feedback.id)}
                          onChange={(e) => handleSelectOne(feedback.id, e.target.checked)}
                          className="rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {formatDate(feedback.timestamp)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100 max-w-md">
                        <div 
                          className="line-clamp-3 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                          onClick={() => setSelectedFeedback(feedback)}
                        >
                          {feedback.feedback}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {feedback.contactInfo ? (
                          isValidEmail(feedback.contactInfo) ? (
                            <a
                              href={generateMailtoUrl(feedback.contactInfo, feedback.timestamp, feedback.feedback)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
                            >
                              {feedback.contactInfo}
                            </a>
                          ) : (
                            feedback.contactInfo
                          )
                        ) : (
                          'Not provided'
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          feedback.archived
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                            : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                        }`}>
                          {feedback.archived ? 'Archived' : 'Active'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                        <button
                          onClick={() => handleArchive(feedback.id, !feedback.archived)}
                          className={`${
                            feedback.archived
                              ? 'text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300'
                              : 'text-yellow-600 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-300'
                          }`}
                        >
                          {feedback.archived ? 'Unarchive' : 'Archive'}
                        </button>
                        <button
                          onClick={() => handleDelete(feedback.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Feedback Detail Modal */}
      {selectedFeedback && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 dark:bg-gray-900 dark:bg-opacity-75 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border border-gray-200 dark:border-gray-700 w-11/12 max-w-2xl shadow-lg rounded-md bg-white dark:bg-gray-800">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Feedback Details</h3>
              <button
                onClick={() => setSelectedFeedback(null)}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Submitted</p>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {formatDate(selectedFeedback.timestamp)}
                </p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Contact Information</p>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {selectedFeedback.contactInfo ? (
                    isValidEmail(selectedFeedback.contactInfo) ? (
                      <a
                        href={generateMailtoUrl(selectedFeedback.contactInfo, selectedFeedback.timestamp, selectedFeedback.feedback)}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
                      >
                        {selectedFeedback.contactInfo}
                      </a>
                    ) : (
                      selectedFeedback.contactInfo
                    )
                  ) : (
                    'Not provided'
                  )}
                </p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</p>
                <span className={`inline-flex mt-1 px-2 py-1 text-xs font-semibold rounded-full ${
                  selectedFeedback.archived
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                    : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                }`}>
                  {selectedFeedback.archived ? 'Archived' : 'Active'}
                </span>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Message</p>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-900 dark:text-gray-100">
                    {selectedFeedback.feedback}
                  </pre>
                </div>
              </div>
              
              {selectedFeedback.userAgent && (
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">User Agent</p>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 break-all">
                    {selectedFeedback.userAgent}
                  </p>
                </div>
              )}
            </div>
            
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => {
                  handleArchive(selectedFeedback.id, !selectedFeedback.archived);
                  setSelectedFeedback(null);
                }}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  selectedFeedback.archived
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-yellow-600 text-white hover:bg-yellow-700'
                }`}
              >
                {selectedFeedback.archived ? 'Unarchive' : 'Archive'}
              </button>
              <button
                onClick={() => {
                  handleDelete(selectedFeedback.id);
                  setSelectedFeedback(null);
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium"
              >
                Delete
              </button>
              <button
                onClick={() => setSelectedFeedback(null)}
                className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}