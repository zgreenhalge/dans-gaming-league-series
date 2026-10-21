'use client';

import { Component, type ReactNode } from 'react';

/** Renders `fallback` in place of `children` once anything below throws while rendering — for a
 *  section whose failure shouldn't replace the whole page with the route's error UI. */
export default class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
