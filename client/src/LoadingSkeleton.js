// client/src/LoadingSkeleton.js
import React from 'react';
import './App.css';

export default function LoadingSkeleton({ width = '100%', height = '1em' }) {
  return <div className="skeleton" style={{ width, height }}></div>;
}
