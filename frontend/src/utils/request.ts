import axios, { AxiosRequestConfig } from 'axios';
import { message } from 'antd';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface RequestConfig extends AxiosRequestConfig {
  /** 调用方自行处理错误提示时置为 true，拦截器不再全局弹窗 */
  skipErrorMessage?: boolean;
}

export const request = axios.create({
  baseURL: '',
  timeout: 10000,
  headers: {
    'x-demo-role': 'Admin'
  }
});

request.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.config?.skipErrorMessage) {
      const text = error.response?.data?.message || error.message || '请求失败';
      message.error(text);
    }
    return Promise.reject(error);
  }
);

export async function getData<T>(url: string, config?: RequestConfig): Promise<T> {
  const response = await request.get<ApiResponse<T>>(url, config);
  return response.data.data;
}

export async function postData<T>(url: string, payload: unknown, config?: RequestConfig): Promise<T> {
  const response = await request.post<ApiResponse<T>>(url, payload, config);
  return response.data.data;
}

export async function patchData<T>(url: string, payload?: unknown, config?: RequestConfig): Promise<T> {
  const response = await request.patch<ApiResponse<T>>(url, payload, config);
  return response.data.data;
}
