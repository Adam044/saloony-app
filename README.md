# 💇‍♀️ Saloony - Salon Booking App

A modern salon booking application built with Node.js, Express, and SQLite.

## 🚀 Features

- **User Registration & Authentication**
- **Salon Discovery & Booking**
- **Real-time Appointment Management**
- **Service Customization**
- **Reviews & Ratings**
- **Responsive Design**

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite3
- **Frontend**: HTML5, CSS3, JavaScript
- **Styling**: Custom CSS with RTL support

## 📦 Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm start
   ```

## 🌐 Deployment to Render

### Prerequisites
- GitHub account
- Render account

### Steps

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Deploy on Render**:
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Render will automatically detect the `render.yaml` configuration

3. **Environment Variables** (if needed):
   - Set `NODE_ENV=production` in Render dashboard
   - Add any additional environment variables

### 🔧 Configuration Files

- `render.yaml` - Render deployment configuration
- `.env` - Environment variables (local development)
- `.gitignore` - Git ignore rules

## 📱 Progressive Web App (PWA) Features

Ready for PWA conversion with:
- Responsive design
- Service worker ready
- Manifest file ready
- App icons included

## 🏪 App Store Deployment

After successful web deployment, the app can be wrapped for:
- **iOS App Store** (using Capacitor/Cordova)
- **Google Play Store** (using Capacitor/Cordova)

## 📄 License

ISC License