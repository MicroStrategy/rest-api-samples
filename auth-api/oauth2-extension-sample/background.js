// OAuth2 Configuration
const config = {
  clientId: 'YOUR_CLIENT_ID', // Replace with your OAuth2 client ID
  clientSecret: 'YOUR_CLIENT_SECRET', // Replace with your OAuth2 client secret
  tokenEndpoint: 'http://hostname:8080/MicroStrategyLibrary/oauth2/token' // Replace with your OAuth2 token endpoint
};

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('OAuth2 Extension installed');
});

// Function to check if token is expired
function isTokenExpired(expiresAt) {
  if (!expiresAt) return true;
  // Add 5 minute buffer to refresh token before it actually expires
  return Date.now() >= (expiresAt - 5 * 60 * 1000);
}

// Function to refresh access token
async function refreshAccessToken(refreshToken) {
  try {
    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error_description || errorData.error || 'Token refresh failed');
    }

    const tokenData = await response.json();
    
    if (!tokenData.access_token) {
      throw new Error('No access token received during refresh');
    }

    // Store new tokens
    await chrome.storage.local.set({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || refreshToken,
      tokenExpiresAt: Date.now() + (tokenData.expires_in * 1000)
    });

    return tokenData.access_token;
  } catch (error) {
    console.error('Token refresh error:', error);
    // Clear tokens on refresh failure
    await chrome.storage.local.remove([
      'accessToken',
      'refreshToken',
      'isAuthenticated',
      'tokenExpiresAt'
    ]);
    throw error;
  }
}

// Function to check if token needs refresh
async function checkAndRefreshToken() {
  try {
    const { accessToken, refreshToken, tokenExpiresAt } = await chrome.storage.local.get([
      'accessToken',
      'refreshToken',
      'tokenExpiresAt'
    ]);
    
    if (!accessToken || !refreshToken) {
      return null;
    }

    // Check if token is expired or about to expire
    if (isTokenExpired(tokenExpiresAt)) {
      return await refreshAccessToken(refreshToken);
    }

    return accessToken;
  } catch (error) {
    console.error('Token check error:', error);
    return null;
  }
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'getAccessToken') {
    checkAndRefreshToken()
      .then(token => {
        if (!token) {
          sendResponse({ error: 'No valid token available' });
        } else {
          sendResponse({ token });
        }
      })
      .catch(error => sendResponse({ error: error.message }));
    return true; // Will respond asynchronously
  }
}); 