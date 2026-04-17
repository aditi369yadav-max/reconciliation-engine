import axios from 'axios';

const BASE = process.env.REACT_APP_API_URL || '';

const api = axios.create({ baseURL: BASE });

export const fetchTransactions = (limit = 20, offset = 0) =>
  api.get(`/api/transactions?limit=${limit}&offset=${offset}`).then(r => r.data);

export const fetchMismatches = (limit = 20, offset = 0) =>
  api.get(`/api/mismatches?limit=${limit}&offset=${offset}`).then(r => r.data);

export const fetchAnalytics = () =>
  api.get('/api/analytics').then(r => r.data);

export const fetchRuns = () =>
  api.get('/api/runs').then(r => r.data);

export const triggerReconcile = () =>
  api.post('/api/reconcile').then(r => r.data);

export const simulateTransactions = (count = 5) =>
  api.post('/api/simulate', { count }).then(r => r.data);

export const fetchHealth = () =>
  api.get('/health').then(r => r.data);
