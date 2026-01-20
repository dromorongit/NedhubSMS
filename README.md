# Nedhub Bulk Messaging SaaS

A comprehensive bulk SMS messaging platform built with modern web technologies, featuring user management, billing integration, and administrative controls.

## 🚀 Features

### User Features
- **Bulk SMS Sending**: Send messages to multiple recipients simultaneously
- **Contact Management**: Organize contacts with groups and categories
- **Message Templates**: Save and reuse frequently used messages
- **Campaign Management**: Schedule and track bulk messaging campaigns
- **Real-time Billing**: Credit-based system with automatic deductions
- **Usage Analytics**: Track sending limits and message history

### Admin Features (Stage 4)
- **User Governance**: Complete user lifecycle management
- **Financial Controls**: Wallet balance adjustments and account freezing
- **Sender ID Approval**: Centralized moderation of custom sender IDs
- **Platform Monitoring**: Real-time analytics and system health
- **Audit Logging**: Complete administrative action tracking
- **Campaign Oversight**: Emergency stop and monitoring capabilities

## 🛠️ Technology Stack

### Backend
- **Runtime**: Node.js with Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT with bcrypt password hashing
- **SMS Gateway**: Nalo Solutions API integration
- **Security**: Rate limiting, CORS, input validation

### Frontend
- **HTML5/CSS3**: Modern responsive interface
- **TypeScript**: Type-safe client-side utilities
- **Client-side Routing**: Dynamic page navigation
- **Local Storage**: Session persistence

## 📁 Project Structure

```
NedhubSMS/
├── index.html                 # Main entry point
├── src/                       # Frontend source
│   ├── app.ts                # Application initialization
│   ├── pages/                # HTML pages
│   │   ├── auth/            # Authentication pages
│   │   ├── dashboard/       # User dashboard pages
│   │   └── admin/           # Admin panel pages
│   ├── styles/              # CSS stylesheets
│   └── utils/               # Client-side utilities
├── backend/                  # Backend API
│   ├── src/server/index.js  # Express server
│   ├── routes/             # API route handlers
│   ├── models/             # MongoDB schemas
│   ├── middleware/         # Express middleware
│   └── utils/              # Server utilities
├── .nojekyll               # Disable Jekyll processing
├── _config.yml             # Jekyll configuration
└── .gitignore             # Git ignore rules
```

## 🚀 Deployment

### Frontend (GitHub Pages)
The frontend is configured for GitHub Pages deployment:
- `.nojekyll` prevents Jekyll processing of static files
- All paths are relative for proper routing
- Admin panel accessible at `/admin` route

### Backend
Deploy separately to a Node.js hosting service:
- Railway, Heroku, or DigitalOcean App Platform recommended
- Requires MongoDB database connection
- Environment variables for API keys and configuration

## 🔧 Setup & Installation

### Prerequisites
- Node.js (v14+)
- MongoDB database
- Nalo Solutions SMS API account

### Backend Setup
```bash
cd backend
npm install
cp .env.example .env  # Configure environment variables
npm start
```

### Frontend Development
```bash
# Serve locally (e.g., using Python)
python -m http.server 8080
# Or use any static file server
```

## 🔐 Environment Variables

### Backend (.env)
```env
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/nedhub_bulk_messaging
JWT_SECRET=your_secure_jwt_secret
JWT_EXPIRES_IN=24h
NALO_API_KEY=your_nalo_api_key
NALO_API_URL=https://api.nalosolutions.com/v1/sms
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

## 📊 Database Models

- **User**: Authentication, roles, account status
- **Wallet**: Credit balances, usage limits, transactions
- **Message**: SMS logs, delivery status
- **Campaign**: Bulk messaging campaigns
- **Contact**: User contact lists
- **SenderId**: Custom sender ID requests
- **Template**: Message templates
- **Transaction**: Billing records
- **AuditLog**: Admin action tracking

## 🔒 Security Features

- JWT-based authentication with role-based access
- Password hashing with bcrypt
- Rate limiting on API endpoints
- Input validation and sanitization
- CORS protection
- Audit logging for admin actions

## 📈 Business Model

- **SaaS Subscription**: User accounts with tiered pricing
- **SMS Credits**: Prepaid messaging credits
- **API Access**: Programmatic SMS sending
- **White-label**: Custom branding options

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

This project is licensed under the ISC License.

## 📞 Support

For support and questions, please open an issue on GitHub.

---

**Built with ❤️ for the Ghanaian SMS market**