// Test script to verify STS flow
// Run this in your browser console after logging in

async function testStsFlow() {
  console.log('=== Testing STS Flow ===');

  // 1. Check environment variables
  console.log('1. Environment Variables:');
  console.log(
    '   VITE_APP_TENANT_ROLE_ARN:',
    import.meta.env.VITE_APP_TENANT_ROLE_ARN
  );
  console.log(
    '   VITE_APP_USE_STS_TEMP_CREDENTIALS:',
    import.meta.env.VITE_APP_USE_STS_TEMP_CREDENTIALS
  );

  // 2. Get current session
  console.log('\n2. Getting Auth Session...');
  const { fetchAuthSession } = await import('aws-amplify/auth');
  const session = await fetchAuthSession();

  // 3. Check JWT token
  console.log('\n3. JWT Token Info:');
  const idToken = session.tokens?.idToken;
  if (idToken) {
    const payload = idToken.payload;
    console.log('   User:', payload.email);
    console.log('   Tenant ID:', payload['custom:tenant_id']);
    console.log('   Principal Tags:', payload['https://aws.amazon.com/tags']);
  }

  // 4. Check identity credentials
  console.log('\n4. Identity Credentials:');
  console.log('   Identity ID:', session.identityId);
  console.log('   Credentials:', session.credentials);

  // 5. Make a test API call
  console.log('\n5. Testing API Call with STS...');
  try {
    const response = await fetch(
      `${import.meta.env.VITE_APP_API_ENDPOINT}/conversation`,
      {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      }
    );
    console.log('   API Response Status:', response.status);
  } catch (error) {
    console.error('   API Error:', error);
  }

  console.log('\n=== Test Complete ===');
}

// Run the test
testStsFlow();
