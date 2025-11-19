import React from 'react';
import { toast } from 'sonner';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    toast.error('予期しないエラーが発生しました');
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-aws-squid-ink p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-8 shadow-lg">
            <div className="mb-6 flex items-center">
              <div className="mr-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <svg
                  className="h-6 w-6 text-red-600"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor">
                  <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  予期しないエラーが発生しました
                </h1>
                <p className="text-gray-600">
                  アプリケーションの実行中に問題が発生しました
                </p>
              </div>
            </div>

            <div className="mb-6 rounded-md bg-gray-50 p-4">
              <h2 className="mb-2 font-semibold text-gray-900">
                エラーの詳細:
              </h2>
              <p className="mb-2 font-mono text-sm text-red-600">
                {this.state.error?.message}
              </p>
              {this.state.error?.stack && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">
                    スタックトレースを表示
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-800 p-3 font-mono text-xs text-gray-100">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}
            </div>

            <div className="flex gap-4">
              <button
                onClick={this.handleReload}
                className="flex-1 rounded-md bg-aws-sea-blue px-4 py-2 font-semibold text-white transition-colors hover:bg-aws-sea-blue-hover">
                ページをリロード
              </button>
              <button
                onClick={this.handleReset}
                className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-700 transition-colors hover:bg-gray-50">
                エラーを無視して続行
              </button>
            </div>

            <div className="mt-6 rounded-md bg-blue-50 p-4">
              <p className="text-sm text-blue-800">
                この問題が繰り返し発生する場合は、管理者にお問い合わせください。
              </p>
            </div>
          </div>
        </div>
      );
    }

    return <>{this.props.children}</>;
  }
}
