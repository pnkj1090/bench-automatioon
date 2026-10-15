import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TENANT_ID = 'a45fe71a-f480-4e42-ad5e-aff33165aa35';
const CLIENT_ID = '48feeb16-a029-4420-b4ff-0c287d0fb9ec';
const REFRESH_TOKEN_FILE = path.join(__dirname, 'refresh-token.txt');
const ACCESS_TOKEN_FILE = path.join(__dirname, 'token.txt');

export async function refreshAccessToken(customRefreshToken = null) {
  let refreshToken = customRefreshToken;
  
  if (!refreshToken) {
    if (!fs.existsSync(REFRESH_TOKEN_FILE)) {
      return { success: false, error: 'No refresh token stored' };
    }
    refreshToken = fs.readFileSync(REFRESH_TOKEN_FILE, 'utf8').trim();
  }

  if (!refreshToken) {
    return { success: false, error: 'Stored refresh token is empty' };
  }

  const tokenEndpoint = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append('client_id', CLIENT_ID);
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);

  try {
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://opportunistic-placement.azurewebsites.net'
      },
      body: params.toString()
    });

    const data = await res.json();
    if (!res.ok) {
      return { 
        success: false, 
        error: data.error_description || data.error || 'Failed to exchange refresh token' 
      };
    }

    if (data.access_token) {
      // Save new access token
      fs.writeFileSync(ACCESS_TOKEN_FILE, data.access_token, 'utf8');
      
      // Save rolled refresh token if provided
      if (data.refresh_token) {
        fs.writeFileSync(REFRESH_TOKEN_FILE, data.refresh_token, 'utf8');
      } else if (customRefreshToken) {
        fs.writeFileSync(REFRESH_TOKEN_FILE, customRefreshToken, 'utf8');
      }

      return {
        success: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresIn: data.expires_in,
        expiresAt: new Date(Date.now() + (data.expires_in * 1000)).toISOString()
      };
    }

    return { success: false, error: 'Azure AD did not return an access token' };
  } catch (err) {
    return { success: false, error: `Network error during token refresh: ${err.message}` };
  }
}
