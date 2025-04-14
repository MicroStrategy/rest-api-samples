// OAuth2 Configuration
const config = {
  clientId: 'YOUR_CLIENT_ID', // Replace with your OAuth2 client ID
  clientSecret: 'YOUR_CLIENT_SECRET', // Replace with your OAuth2 client secret
  redirectUri: chrome.identity.getRedirectURL(),
  authEndpoint: 'http://hostname:8080/MicroStrategyLibrary/oauth2/authorize', // Replace with your OAuth2 authorization endpoint
  tokenEndpoint: 'http://hostname:8080/MicroStrategyLibrary/oauth2/token', // Replace with your OAuth2 token endpoint
  scope: 'offline_access'
};

// PKCE Utility Functions
function generateRandomString(length) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function generateCodeChallenge(codeVerifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// DOM Elements
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const getTokenBtn = document.getElementById('getTokenBtn');
const tokenDisplay = document.getElementById('tokenDisplay');
const statusDiv = document.getElementById('status');

// Check authentication status when popup opens
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const { isAuthenticated } = await chrome.storage.local.get('isAuthenticated');
    updateUI(isAuthenticated);
  } catch (error) {
    console.error('Failed to check authentication status:', error);
    showStatus('Failed to check authentication status', 'error');
  }
});

// Handle login button click
loginBtn.addEventListener('click', async () => {
  try {
    // Generate PKCE code verifier and challenge
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    
    // Store code verifier for later use
    await chrome.storage.local.set({ codeVerifier });

    // Construct authorization URL with PKCE parameters
    const authUrl = new URL(config.authEndpoint);
    authUrl.searchParams.append('client_id', config.clientId);
    authUrl.searchParams.append('redirect_uri', config.redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', config.scope);
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');

    // Launch OAuth2 flow
    const redirectUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true
    });

    if (!redirectUrl) {
      throw new Error('Authorization was cancelled');
    }

    // Extract authorization code from redirect URL
    const url = new URL(redirectUrl);
    const code = url.searchParams.get('code');
    
    if (!code) {
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');
      throw new Error(errorDescription || error || 'Authorization failed');
    }

    // Get stored code verifier
    const { codeVerifier: storedVerifier } = await chrome.storage.local.get('codeVerifier');
    
    if (!storedVerifier) {
      throw new Error('Code verifier not found');
    }

    // Exchange code for access token with PKCE
    const tokenResponse = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: storedVerifier
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      throw new Error(errorData.error_description || errorData.error || 'Token exchange failed');
    }

    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) {
      throw new Error('No access token received');
    }
    
    // Store tokens and clear code verifier
    await chrome.storage.local.set({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      isAuthenticated: true,
      tokenExpiresAt: Date.now() + (tokenData.expires_in * 1000)
    });
    await chrome.storage.local.remove('codeVerifier');

    updateUI(true);
    showStatus('Successfully authenticated!', 'success');
  } catch (error) {
    console.error('Authentication error:', error);
    showStatus('Authentication failed: ' + error.message, 'error');
    // Clear any stored state on error
    await chrome.storage.local.remove(['codeVerifier', 'isAuthenticated']);
  }
});

// Handle logout button click
logoutBtn.addEventListener('click', async () => {
  try {
    // Clear stored tokens
    await chrome.storage.local.remove([
      'accessToken',
      'refreshToken',
      'isAuthenticated',
      'tokenExpiresAt'
    ]);
    updateUI(false);
    showStatus('Successfully logged out!', 'success');
  } catch (error) {
    console.error('Logout error:', error);
    showStatus('Logout failed: ' + error.message, 'error');
  }
});

// Handle get token button click
getTokenBtn.addEventListener('click', async () => {
  try {
    // Send message to background script to get access token
    chrome.runtime.sendMessage({ type: 'getAccessToken' }, response => {
      if (response.error) {
        showStatus('Failed to get access token: ' + response.error, 'error');
      } else if (response.token) {
        // Display the token
        tokenDisplay.textContent = response.token;
        tokenDisplay.style.display = 'block';
        showStatus('Access token retrieved successfully!', 'success');
      } else {
        showStatus('Failed to get access token: Unknown error', 'error');
      }
    });
  } catch (error) {
    console.error('Get token error:', error);
    showStatus('Failed to get access token: ' + error.message, 'error');
  }
});

// Helper function to update UI based on authentication status
function updateUI(isAuthenticated) {
  loginBtn.style.display = isAuthenticated ? 'none' : 'block';
  logoutBtn.style.display = isAuthenticated ? 'block' : 'none';
  getTokenBtn.style.display = isAuthenticated ? 'block' : 'none';
  tokenDisplay.style.display = 'none';
}

// Helper function to show status messages
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = type;
}