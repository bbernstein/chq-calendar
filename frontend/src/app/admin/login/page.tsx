import { useEffect, useState } from 'react'
import { API_BASE_URL } from '@/lib/api'

function LoginContent() {
  const [error, setError] = useState('')

  useEffect(() => {
    // Check if running on localhost - bypass authentication for local development
    const isLocalhost = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (isLocalhost) {
      // Set dummy user and redirect to feedback page for local development
      const dummyUser = {
        email: 'dev@localhost.local',
        name: 'Local Dev User'
      };
      localStorage.setItem('chq_auth_user', JSON.stringify(dummyUser));
      localStorage.setItem('chq_auth_token', 'dummy-local-token');
      console.log('Localhost detected - bypassing auth, redirecting to /admin/feedback');
      window.location.href = '/admin/feedback/';
      return;
    }

    // Handle OAuth callback from hash fragment
    const hash = window.location.hash;
    const searchParams = new URLSearchParams(window.location.search);
    const errorParam = searchParams.get('error')

    console.log('Login page useEffect - hash:', !!hash, 'errorParam:', errorParam)

    if (hash && hash.startsWith('#auth=')) {
      try {
        const authData = hash.substring(6); // Remove '#auth='
        const { email, name, token } = JSON.parse(decodeURIComponent(authData));

        console.log('Parsing auth data from hash...')
        localStorage.setItem('chq_auth_token', token)
        localStorage.setItem('chq_auth_user', JSON.stringify({ email, name }))
        console.log('Token stored, redirecting to /admin/feedback')

        // Clear the hash from URL
        window.history.replaceState(null, '', window.location.pathname);

        // Small delay to ensure localStorage is properly set before redirect
        setTimeout(() => {
          window.location.href = '/admin/feedback/'
        }, 100)
        return
      } catch (err) {
        console.error('Error parsing auth data:', err)
        setError('Invalid authentication data')
      }
    }

    // Legacy support for query parameters (in case they still come through)
    const token = searchParams.get('token')
    const userParam = searchParams.get('user')

    if (token && userParam) {
      try {
        console.log('Parsing user data from query params...')
        const user = JSON.parse(decodeURIComponent(userParam))
        localStorage.setItem('chq_auth_token', token)
        localStorage.setItem('chq_auth_user', JSON.stringify(user))
        console.log('Token stored, redirecting to /admin/feedback')

        setTimeout(() => {
          window.location.href = '/admin/feedback/'
        }, 100)
        return
      } catch (err) {
        console.error('Error parsing user data:', err)
        setError('Invalid authentication data')
      }
    }

    if (errorParam) {
      switch (errorParam) {
        case 'oauth_error':
          setError('OAuth authentication failed')
          break
        case 'no_code':
          setError('No authorization code received')
          break
        case 'no_email':
          setError('Unable to retrieve email from Google')
          break
        case 'unauthorized':
          setError('Your email is not authorized to access this system')
          break
        case 'callback_error':
          setError('Authentication callback failed')
          break
        default:
          setError('Authentication error occurred')
      }
    }

    // Check if already authenticated
    const existingToken = localStorage.getItem('chq_auth_token')
    if (existingToken && !token) {
      window.location.href = '/admin/feedback/'
    }
  }, [])

  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE_URL}/auth/google`
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
            Admin Login
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-300">
            Sign in to access the feedback management system
          </p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800 dark:text-red-400">
                  Authentication Error
                </h3>
                <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <button
            onClick={handleGoogleLogin}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 focus:ring-blue-500 transition-colors"
          >
            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return <LoginContent />
}
