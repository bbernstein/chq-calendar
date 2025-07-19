'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';

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

export default function FeedbackManagementPage() {
  const [feedbacks, setFeedbacks] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('all');

  const apiUrl = process.env.NODE_ENV === 'development'
    ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001')
    : '/api';

  const fetchFeedbacks = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${apiUrl}/admin/feedback`);
      
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
  };

  useEffect(() => {
    fetchFeedbacks();
  }, []);

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
      const response = await fetch(`${apiUrl}/admin/feedback`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
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
      const response = await fetch(`${apiUrl}/admin/feedback`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
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
      const response = await fetch(`${apiUrl}/admin/feedback/bulk`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-lg text-gray-600">Loading feedback...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center">
              <Image
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar Logo"
                width={32}
                height={32}
                className="w-8 h-8 mr-3"
              />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                Feedback Management
              </h1>
            </div>
            <div className="text-sm text-gray-600">
              {filteredFeedbacks.length} feedback item(s)
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* Controls */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            {/* Filter */}
            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                All ({feedbacks.length})
              </button>
              <button
                onClick={() => setFilter('active')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'active'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Active ({feedbacks.filter(f => !f.archived).length})
              </button>
              <button
                onClick={() => setFilter('archived')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'archived'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Archived ({feedbacks.filter(f => f.archived).length})
              </button>
            </div>

            {/* Bulk Actions */}
            {selectedIds.length > 0 && (
              <div className="flex gap-2">
                <span className="text-sm text-gray-600 self-center">
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
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {filteredFeedbacks.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No feedback found for the selected filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === filteredFeedbacks.length && filteredFeedbacks.length > 0}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Feedback
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contact Info
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredFeedbacks.map((feedback) => (
                    <tr key={feedback.id} className={feedback.archived ? 'bg-gray-50' : ''}>
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(feedback.id)}
                          onChange={(e) => handleSelectOne(feedback.id, e.target.checked)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(feedback.timestamp)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-md">
                        <div className="line-clamp-3">
                          {feedback.feedback}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {feedback.contactInfo || 'Not provided'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          feedback.archived
                            ? 'bg-gray-100 text-gray-800'
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {feedback.archived ? 'Archived' : 'Active'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                        <button
                          onClick={() => handleArchive(feedback.id, !feedback.archived)}
                          className={`${
                            feedback.archived
                              ? 'text-green-600 hover:text-green-900'
                              : 'text-yellow-600 hover:text-yellow-900'
                          }`}
                        >
                          {feedback.archived ? 'Unarchive' : 'Archive'}
                        </button>
                        <button
                          onClick={() => handleDelete(feedback.id)}
                          className="text-red-600 hover:text-red-900"
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
    </div>
  );
}