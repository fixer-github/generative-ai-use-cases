import { useMemo } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import useSWR from 'swr';

const useAdmin = () => {
  const { data: session } = useSWR('admin-session', () => {
    return fetchAuthSession();
  });

  const isAdmin = useMemo(() => {
    const groups = (session?.tokens?.idToken?.payload['cognito:groups'] ??
      []) as string[];
    return groups.includes('admin');
  }, [session]);

  const currentUsername = useMemo(() => {
    return (session?.tokens?.idToken?.payload['cognito:username'] ??
      session?.tokens?.idToken?.payload['sub'] ??
      '') as string;
  }, [session]);

  return { isAdmin, currentUsername };
};

export default useAdmin;
