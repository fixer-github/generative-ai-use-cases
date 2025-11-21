const {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
} = require('@aws-sdk/client-cloudfront-keyvaluestore');

const updateStatus = async (event, status, reason, physicalResourceId) => {
  const body = JSON.stringify({
    Status: status,
    Reason: reason,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: {},
  });

  const res = await fetch(event.ResponseURL, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': '',
      'Content-Length': body.length.toString(),
    },
  });

  console.log(res);
  console.log(await res.text());
};

exports.handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties;
  const kvsArn = props.KvsARN;
  const physicalResourceId = `kvs-init-${kvsArn}`;

  const client = new CloudFrontKeyValueStoreClient({});

  try {
    if (event.RequestType === 'Delete') {
      // No cleanup needed - keys can remain in KVS
      await updateStatus(event, 'SUCCESS', 'Delete completed', physicalResourceId);
      return;
    }

    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      console.log('Describing KeyValueStore to get ETag');

      // Get initial ETag
      const describeResponse = await client.send(
        new DescribeKeyValueStoreCommand({ KvsARN: kvsArn })
      );
      let currentETag = describeResponse.ETag;
      console.log('Initial ETag:', currentETag);

      // Set maintenance key to 'false'
      console.log('Setting maintenance key');
      const maintenanceResponse = await client.send(
        new PutKeyCommand({
          KvsARN: kvsArn,
          Key: 'maintenance',
          Value: 'false',
          IfMatch: currentETag,
        })
      );
      currentETag = maintenanceResponse.ETag;
      console.log('Maintenance key set, new ETag:', currentETag);

      // Set ipWhitelist key to empty string
      console.log('Setting ipWhitelist key');
      const ipWhitelistResponse = await client.send(
        new PutKeyCommand({
          KvsARN: kvsArn,
          Key: 'ipWhitelist',
          Value: '',
          IfMatch: currentETag,
        })
      );
      console.log('ipWhitelist key set, final ETag:', ipWhitelistResponse.ETag);

      await updateStatus(
        event,
        'SUCCESS',
        'KeyValueStore initialized successfully',
        physicalResourceId
      );
    }
  } catch (error) {
    console.error('Error:', error);
    await updateStatus(
      event,
      'FAILED',
      error.message || 'Unknown error occurred',
      physicalResourceId
    );
  }
};
