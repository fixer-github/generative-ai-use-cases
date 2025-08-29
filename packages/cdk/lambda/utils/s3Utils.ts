/**
 * Convert s3://<BUCKET>/<PREFIX> to https://s3.<REGION>.amazonaws.com/<BUCKET>/<PREFIX>
 */
export const convertS3UriToUrl = (s3Uri: string, region: string): string => {
  const result = /^s3:\/\/(?<bucketName>.+?)\/(?<prefix>.+)/.exec(s3Uri);
  if (result) {
    const groups = result?.groups as {
      bucketName: string;
      prefix: string;
    };
    return `https://s3.${region}.amazonaws.com/${groups.bucketName}/${groups.prefix}`;
  }
  return '';
};

/**
 * Encode a string to URL
 */
export const encodeUrlString = (str: string): string => {
  try {
    return encodeURIComponent(str);
  } catch (e) {
    console.error('Failed to URL-encode string:', e);
    return str;
  }
};