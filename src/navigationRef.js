import { createRef } from 'react';
import { CommonActions } from '@react-navigation/native';

export const navigationRef = createRef();

export function navigate(name, params) {
  navigationRef.current?.dispatch(CommonActions.navigate({ name, params }));
}
