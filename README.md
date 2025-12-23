# TiffinMate Backend

## Setup Instructions

1. Install dependencies:
```bash
npm install
```

2. Make sure MongoDB is running on your system:
```bash
# For Windows (if MongoDB is installed as a service, it should already be running)
# Otherwise, start MongoDB manually

# For Mac/Linux
mongod
```

3. Start the server:
```bash
npm start
```

The server will run on http://localhost:3000

## API Endpoints

- `GET /api/providers` - Get all providers
- `POST /api/subscriptions` - Create subscription
- `GET /api/subscriptions/:userId` - Get user's subscription
- `POST /api/subscriptions/pause/:subscriptionId` - Pause subscription
- `POST /api/subscriptions/resume/:subscriptionId` - Resume subscription

## Database

The database will be automatically seeded with sample providers on first run.
