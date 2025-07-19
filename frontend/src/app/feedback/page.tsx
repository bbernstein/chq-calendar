'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';

// Declare the global grecaptcha object
declare global {
  interface Window {
    grecaptcha: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

export default function FeedbackPage() {
  const [feedback, setFeedback] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [captchaReady, setCaptchaReady] = useState(false);

  // reCAPTCHA site key - this should be set via environment variable
  const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI'; // Test key

  const apiUrl = process.env.NODE_ENV === 'development'
    ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001')
    : '/api';

  useEffect(() => {
    // Load reCAPTCHA script
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    script.onload = () => {
      if (window.grecaptcha) {
        window.grecaptcha.ready(() => {
          setCaptchaReady(true);
        });
      }
    };

    return () => {
      // Cleanup script on unmount
      document.head.removeChild(script);
    };
  }, [RECAPTCHA_SITE_KEY]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!feedback.trim()) {
      setError('Please enter your feedback');
      return;
    }

    if (!captchaReady) {
      setError('reCAPTCHA is not ready. Please wait and try again.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // Get reCAPTCHA token if available
      let captchaToken = '';
      if (captchaReady && window.grecaptcha) {
        try {
          captchaToken = await window.grecaptcha.execute(RECAPTCHA_SITE_KEY, {
            action: 'submit_feedback'
          });
        } catch (captchaError) {
          console.warn('CAPTCHA execution failed:', captchaError);
          // Continue without CAPTCHA in development
        }
      }

      // Submit feedback
      const response = await fetch(`${apiUrl}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feedback: feedback.trim(),
          contactInfo: contactInfo.trim() || undefined,
          captchaToken: captchaToken || undefined,
        }),
      });

      if (response.ok) {
        setIsSubmitted(true);
        setFeedback('');
        setContactInfo('');
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to submit feedback. Please try again.');
      }
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 max-w-md w-full text-center">
          <div className="text-green-600 text-5xl mb-4">✓</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Thank You!</h1>
          <p className="text-gray-600 mb-6">
            Your feedback has been submitted successfully. We appreciate your input and will review it carefully.
          </p>
          <button
            onClick={() => {
              setIsSubmitted(false);
              setError('');
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors mr-4"
          >
            Submit More Feedback
          </button>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center py-4">
            <Image
              src="/chq-calendar-icon-256.svg"
              alt="Chautauqua Calendar Logo"
              width={32}
              height={32}
              className="w-8 h-8 mr-3"
            />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              Feedback
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              We would Love Your Feedback
            </h2>
            <p className="text-gray-600">
              Help us improve the Chautauqua Calendar experience. Your comments and suggestions are valuable to us.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="feedback" className="block text-sm font-medium text-gray-700 mb-2">
                Please enter comments/feedback. Include contact info if you would like a response.
              </label>
              <textarea
                id="feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={6}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Your feedback, comments, or suggestions..."
                required
              />
            </div>

            <div>
              <label htmlFor="contactInfo" className="block text-sm font-medium text-gray-700 mb-2">
                Contact Information (Optional)
              </label>
              <input
                type="text"
                id="contactInfo"
                value={contactInfo}
                onChange={(e) => setContactInfo(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Email or phone number (if you would like a response)"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4">
              <button
                type="submit"
                disabled={isSubmitting || !captchaReady}
                className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
              </button>
              <button
                type="button"
                onClick={() => window.close()}
                className="px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
              >
                Cancel
              </button>
            </div>

            <div className="text-xs text-gray-500 mt-4">
              This site is protected by reCAPTCHA and the Google{' '}
              <a href="https://policies.google.com/privacy" className="text-blue-600 hover:underline">
                Privacy Policy
              </a>{' '}
              and{' '}
              <a href="https://policies.google.com/terms" className="text-blue-600 hover:underline">
                Terms of Service
              </a>{' '}
              apply.
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}