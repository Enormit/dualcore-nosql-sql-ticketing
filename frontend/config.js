/**
 * PolyFlash Frontend API Configuration
 * Khi deploy lên Amazon S3 + CloudFront, thay đổi API_BASE_URL thành URL của Amazon API Gateway:
 * VD: https://xxxxxxxxxx.execute-api.ap-southeast-1.amazonaws.com
 */
window.POLYFLASH_API = {
  BASE_URL: window.location.origin,
  ENDPOINTS: {
    // 1. Events
    LIST_EVENTS: '/api/v1/events',

    // 2. Seats (DynamoDB - Seat Reader & Seat Locker)
    LIST_SEATS: (eventId) => `/api/v1/events/${eventId}/seats`,
    HOLD_SEAT: (eventId, seatId) => `/api/v1/events/${eventId}/seats/${seatId}/hold`,
    RELEASE_SEAT: (eventId, seatId) => `/api/v1/events/${eventId}/seats/${seatId}/release`,

    // 3. Checkout & Tickets (SQS FIFO -> Order Processor -> Neon PostgreSQL)
    PAY_SEAT: (eventId, seatId) => `/api/v1/events/${eventId}/seats/${seatId}/pay`,
    MY_TICKETS: (userId) => `/api/v1/tickets?userId=${encodeURIComponent(userId)}`,

    // 4. Auth & User Profile (Amazon Cognito + Neon PostgreSQL)
    LOGIN: '/api/v1/auth/login',
    REGISTER: '/api/v1/auth/register',
    GET_PROFILE: (userId) => `/api/v1/users/profile?userId=${encodeURIComponent(userId)}`,
    UPDATE_PROFILE: '/api/v1/users/profile',

    // 5. Admin Management
    ADMIN_OVERVIEW: '/api/v1/admin/overview',
    ADMIN_CREATE_EVENT: '/api/v1/admin/events',
    ADMIN_UPDATE_EVENT: (eventId) => `/api/v1/admin/events/${eventId}`,
  },
};
