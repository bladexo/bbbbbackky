# Chatropolis Backend

Real-time chat backend with Socket.IO, Express, and MongoDB.

## Deployment Instructions

### Netlify Deployment

1. Connect your repository to Netlify through the Netlify dashboard

2. Configure the build settings:
   - **Base directory**: `bbbbbackky-main` (or your backend directory)
   - **Build command**: `npm run netlify-build`
   - **Publish directory**: `dist`
   - **Functions directory**: `netlify/functions`

3. Set up the environment variables in Netlify dashboard:
   - `MONGODB_URI` - Your MongoDB connection string
   - `ADMIN_PASSWORD` - Password for admin access
   - `NODE_ENV` - Set to `production`
   - `NETLIFY` - Set to `true`

4. Deploy the site and wait for the build to complete

5. Connect your frontend to the Netlify backend URL using the Socket.IO connection:
   - Backend URL format: `https://your-netlify-site-name.netlify.app`

### Running Locally with Netlify Dev

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with your configuration:
   ```
   PORT=8000
   HOST=0.0.0.0
   NODE_ENV=development
   MONGODB_URI=your-mongodb-uri
   ADMIN_PASSWORD=your-admin-password
   NETLIFY_DEV=true
   ```

3. Run Netlify dev environment:
   ```bash
   npm run netlify:dev
   ```

4. Backend will be available at `http://localhost:8000`

## API Endpoints

- `/health` - Health check endpoint
- `/status` - Status page
- `/admin` - Admin dashboard (requires authentication)
- `/socket.io` - Socket.IO endpoint for real-time connections

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MONGODB_URI` | MongoDB connection string | Yes |
| `ADMIN_PASSWORD` | Admin access password | Yes |
| `PORT` | Server port (default: 8000) | No |
| `NODE_ENV` | Environment (`development` or `production`) | No |
| `NETLIFY` | Enable Netlify mode | No |
| `NETLIFY_DEV` | Enable Netlify local development | No | 