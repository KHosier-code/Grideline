type AdminCheck = {
  data?: boolean;
  isSuccess: boolean;
  isFetching: boolean;
};

export function consumerAccountState(isLoaded: boolean, isSignedIn: boolean | undefined, admin: AdminCheck) {
  const signedIn = isLoaded && isSignedIn === true;
  return {
    signedIn,
    signedOut: isLoaded && isSignedIn === false,
    adminVerified: signedIn && admin.isSuccess && !admin.isFetching && admin.data === true,
  };
}