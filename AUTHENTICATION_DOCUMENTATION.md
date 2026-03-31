# Nedhub Authentication System Documentation

## Overview

This document provides comprehensive documentation for the Nedhub authentication system, including email verification and password reset functionality using OTP (One-Time Password).

## Table of Contents

1. [API Routes](#api-routes)
2. [Database Schema](#database-schema)
3. [Email Flow](#email-flow)
4. [Security Features](#security-features)
5. [Frontend Pages](#frontend-pages)
6. [Configuration](#configuration)

---

## API Routes

### Base URL
```
Production: https://nedhubsms-production.up.railway.app/api
Development: http://localhost:3000/api
```

### Authentication Endpoints

#### 1. Register User
**POST** `/auth/register`

Register a new user and send email verification OTP.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securePassword123"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "OTP sent to your email",
  "email": "john@example.com"
}
```

**Error Responses:**
- `400`: Validation error (missing fields, invalid email, password too short)
- `400`: User already exists
- `500`: Internal server error

---

#### 2. Verify Email
**POST** `/auth/verify-email`

Verify user's email address using the OTP sent during registration.

**Request Body:**
```json
{
  "email": "john@example.com",
  "otp": "123456"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "token": "jwt_token_here",
  "user": {
    "_id": "user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "status": "active",
    "isEmailVerified": true,
    "emailVerifiedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `400`: Email and OTP are required
- `400`: Invalid email format
- `400`: OTP not found or expired
- `400`: Invalid OTP
- `404`: User not found
- `500`: Internal server error

---

#### 3. Request Password Reset
**POST** `/auth/request-password-reset`

Request a password reset OTP to be sent to the user's email.

**Request Body:**
```json
{
  "email": "john@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "If an account exists with this email, you will receive a password reset code"
}
```

**Note:** For security reasons, this endpoint returns the same message whether the email exists or not.

**Error Responses:**
- `400`: Email is required
- `400`: Invalid email format
- `500`: Internal server error

---

#### 4. Reset Password
**POST** `/auth/reset-password`

Reset user's password using the OTP sent via email.

**Request Body:**
```json
{
  "email": "john@example.com",
  "otp": "123456",
  "newPassword": "newSecurePassword123"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

**Error Responses:**
- `400`: Email, OTP, and new password are required
- `400`: Invalid email format
- `400`: Password must be at least 8 characters
- `400`: OTP not found or expired
- `400`: Invalid OTP
- `404`: User not found
- `500`: Internal server error

---

#### 5. Resend OTP
**POST** `/auth/resend-otp`

Resend OTP for email verification or password reset.

**Request Body:**
```json
{
  "email": "john@example.com",
  "purpose": "email_verification" // or "password_reset"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "OTP sent successfully"
}
```

**Error Responses:**
- `400`: Email and purpose are required
- `400`: Invalid email format
- `400`: Invalid purpose
- `404`: User not found
- `500`: Internal server error

---

#### 6. Login
**POST** `/auth/login`

Authenticate user and receive JWT token.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "securePassword123"
}
```

**Response (200):**
```json
{
  "token": "jwt_token_here",
  "userId": "user_id",
  "user": {
    "_id": "user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "status": "active"
  }
}
```

**Error Responses:**
- `400`: Email and password are required
- `401`: Invalid credentials
- `500`: Internal server error

---

#### 7. Verify Token
**GET** `/auth/verify`

Verify JWT token and get current user information.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "user": {
    "_id": "user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "status": "active",
    "isEmailVerified": true
  }
}
```

**Error Responses:**
- `401`: Unauthorized (invalid or missing token)
- `404`: User not found
- `500`: Internal server error

---

## Database Schema

### User Model

```javascript
{
  name: {
    type: String,
    required: [true, 'Please add a name']
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    match: [/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/, 'Please add a valid email']
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: [8, 'Password must be at least 8 characters']
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'super_admin'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['active', 'suspended'],
    default: 'active'
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerifiedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}
```

**Features:**
- Passwords are automatically hashed using bcrypt before saving
- Email validation using regex
- Email verification status tracking

---

### OTP Model

```javascript
{
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true
  },
  otp: {
    type: String,
    required: [true, 'OTP is required']
  },
  purpose: {
    type: String,
    enum: ['email_verification', 'password_reset'],
    required: [true, 'OTP purpose is required']
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 900 // 15 minutes TTL (900 seconds)
  }
}
```

**Indexes:**
- `{ email: 1, purpose: 1 }` - For faster queries
- TTL index on `createdAt` - Automatic deletion after 15 minutes

**Features:**
- OTPs are automatically hashed using bcrypt before saving
- TTL (Time To Live) index for automatic expiration
- Purpose-based OTP management (email verification vs password reset)

---

## Email Flow

### Email Verification Flow

1. **User Registration**
   - User submits registration form with name, email, and password
   - Backend validates input and creates user account
   - Backend generates 6-digit OTP and stores hashed version in database
   - Backend sends verification email with OTP
   - Frontend redirects to email verification page

2. **Email Verification**
   - User receives email with 6-digit OTP
   - User enters OTP on verification page
   - Backend verifies OTP against hashed version in database
   - If valid, backend marks email as verified and generates JWT token
   - User is redirected to dashboard

3. **Resend OTP**
   - User can request new OTP if original expires or is lost
   - Backend deletes old OTP and generates new one
   - New verification email is sent

### Password Reset Flow

1. **Request Password Reset**
   - User submits email on forgot password page
   - Backend generates 6-digit OTP and stores hashed version
   - Backend sends password reset email with OTP
   - Frontend redirects to reset password page

2. **Reset Password**
   - User receives email with 6-digit OTP
   - User enters OTP and new password on reset page
   - Backend verifies OTP and updates password
   - User is redirected to login page

3. **Resend OTP**
   - User can request new OTP if original expires or is lost
   - Backend deletes old OTP and generates new one
   - New password reset email is sent

---

## Security Features

### Password Security
- **Bcrypt Hashing**: All passwords are hashed using bcrypt with salt rounds of 10
- **Minimum Length**: Passwords must be at least 8 characters
- **Pre-save Hook**: Passwords are automatically hashed before saving to database

### OTP Security
- **Bcrypt Hashing**: All OTPs are hashed using bcrypt before storage
- **TTL Index**: OTPs automatically expire after 15 minutes
- **Single Use**: OTPs are deleted after successful verification
- **Purpose Separation**: Different OTPs for email verification and password reset

### Input Validation
- **Email Validation**: Regex validation for email format
- **Required Fields**: All required fields are validated
- **Password Length**: Minimum 8 character requirement

### Rate Limiting
- **Express Rate Limit**: Implemented using `express-rate-limit` package
- **Prevents Abuse**: Limits repeated requests to prevent OTP abuse

### HTTPS
- **Secure Communication**: All frontend-backend communication should use HTTPS
- **Production Ready**: Configured for production deployment

---

## Frontend Pages

### 1. Registration Page
**File**: `src/pages/auth/register.html`

**Features:**
- User registration form with name, email, and password
- Password confirmation field
- Password visibility toggle
- Form validation
- Redirects to email verification page after successful registration

**Flow:**
1. User fills in registration form
2. Frontend validates input
3. Frontend calls `/auth/register` API
4. On success, stores email in localStorage and redirects to verification page

---

### 2. Email Verification Page
**File**: `src/pages/auth/verify-email.html`

**Features:**
- 6-digit OTP input with auto-focus
- Paste support for OTP
- Resend OTP functionality with 60-second cooldown
- Timer showing when resend is available
- Form validation

**Flow:**
1. User enters 6-digit OTP received via email
2. Frontend calls `/auth/verify-email` API
3. On success, stores JWT token and redirects to dashboard
4. User can resend OTP if needed (60-second cooldown)

---

### 3. Forgot Password Page
**File**: `src/pages/auth/forgot-password.html`

**Features:**
- Email input field
- Form validation
- Redirects to reset password page after successful request

**Flow:**
1. User enters email address
2. Frontend calls `/auth/request-password-reset` API
3. On success, stores email in localStorage and redirects to reset password page

---

### 4. Reset Password Page
**File**: `src/pages/auth/reset-password.html`

**Features:**
- 6-digit OTP input with auto-focus
- New password input with visibility toggle
- Confirm password field
- Paste support for OTP
- Resend OTP functionality with 60-second cooldown
- Form validation

**Flow:**
1. User enters OTP received via email
2. User enters new password and confirms it
3. Frontend calls `/auth/reset-password` API
4. On success, redirects to login page
5. User can resend OTP if needed (60-second cooldown)

---

## Configuration

### Environment Variables

Create a `.env` file in the `backend/` directory with the following variables:

```env
# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/nedhub

# JWT Secret
JWT_SECRET=your_jwt_secret_here

# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=support@nedhubgh.com
SMTP_PASS=your_email_password_here

# Server Configuration
PORT=3000
NODE_ENV=production
```

### SMTP Configuration

The email service uses the following SMTP settings:

- **Host**: `smtp.gmail.com` (or your SMTP provider)
- **Port**: `587` (for TLS) or `465` (for SSL)
- **Secure**: `false` for port 587, `true` for port 465
- **User**: `support@nedhubgh.com`
- **Pass**: Your email password or app-specific password

**Note**: For Gmail, you may need to use an App Password instead of your regular password.

---

## Email Templates

### Verification Email Template

**Subject**: Verify Your Email - Nedhub

**Content**:
- Professional HTML email with Nedhub branding
- 6-digit OTP code prominently displayed
- 15-minute expiration notice
- Security information

### Password Reset Email Template

**Subject**: Reset Your Password - Nedhub

**Content**:
- Professional HTML email with Nedhub branding
- 6-digit OTP code prominently displayed
- 15-minute expiration notice
- Security warning about not sharing the code

---

## Error Handling

### Common Error Messages

- **Validation Errors**: "All fields are required", "Invalid email format", "Password must be at least 8 characters"
- **Authentication Errors**: "Invalid credentials", "User already exists", "User not found"
- **OTP Errors**: "OTP not found or expired", "Invalid OTP"
- **Server Errors**: "Internal server error", "Failed to send email"

### Frontend Error Handling

All frontend pages include:
- Error message display with auto-dismiss (5 seconds)
- Success message display
- Loading states during API calls
- Form validation before submission

---

## Testing the Flow

### 1. Test Email Verification

1. Navigate to `/src/pages/auth/register.html`
2. Fill in the registration form
3. Submit the form
4. Check your email for the verification OTP
5. Enter the OTP on the verification page
6. Verify you are redirected to the dashboard

### 2. Test Password Reset

1. Navigate to `/src/pages/auth/forgot-password.html`
2. Enter your registered email
3. Submit the form
4. Check your email for the password reset OTP
5. Enter the OTP and new password on the reset page
6. Verify you are redirected to the login page
7. Login with your new password

### 3. Test Resend OTP

1. On either verification or reset password page
2. Wait for the 60-second cooldown to start
3. Click "Resend Code" button
4. Verify new OTP is sent to your email
5. Verify cooldown timer resets

---

## Troubleshooting

### OTP Not Received

1. Check spam/junk folder
2. Verify SMTP configuration in `.env` file
3. Check server logs for email sending errors
4. Ensure email address is correct

### OTP Expired

1. OTPs expire after 15 minutes
2. Request a new OTP using the "Resend Code" button
3. Wait for 60-second cooldown if recently requested

### Invalid OTP

1. Ensure you're entering the correct 6-digit code
2. Check for typos or extra spaces
3. Request a new OTP if the code has expired
4. Ensure you're using the correct email address

### Password Reset Not Working

1. Ensure you're using the correct email address
2. Verify OTP is entered correctly
3. Ensure new password meets minimum requirements (8 characters)
4. Check that passwords match in both fields

---

## API Rate Limiting

The authentication endpoints are protected by rate limiting to prevent abuse:

- **Window**: 15 minutes
- **Max Requests**: 100 requests per window
- **Message**: "Too many requests, please try again later"

This helps prevent:
- OTP brute force attacks
- Email bombing
- API abuse

---

## Future Enhancements

Potential improvements for the authentication system:

1. **Two-Factor Authentication (2FA)**
   - TOTP (Time-based One-Time Password) support
   - Backup codes for account recovery

2. **Social Login Integration**
   - Google OAuth
   - Facebook Login
   - Apple Sign In

3. **Account Lockout**
   - Lock account after multiple failed login attempts
   - Email notification for suspicious activity

4. **Password Strength Meter**
   - Real-time password strength feedback
   - Requirements checklist

5. **Session Management**
   - View active sessions
   - Revoke specific sessions
   - Session timeout configuration

6. **Audit Logging**
   - Log all authentication events
   - Track login locations and devices
   - Security alerts for unusual activity

---

## Support

For issues or questions regarding the authentication system:

- **Email**: support@nedhubgh.com
- **Documentation**: This file
- **Logs**: Check server logs for detailed error information

---

## Version History

- **v1.0.0** (2024): Initial implementation
  - Email verification with OTP
  - Password reset with OTP
  - Bcrypt password hashing
  - TTL-based OTP expiration
  - Professional email templates
