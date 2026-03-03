/**
 * API base URL for frontend-backend communication.
 *
 * - Production: empty string (CloudFront routes /api, /admin/api, /auth to backend)
 * - Dev with Vite proxy (`npm run dev`): empty string (Vite proxy forwards to backend)
 * - Dev without proxy: set VITE_API_URL=http://localhost:3001 in .env.local
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL || '';
