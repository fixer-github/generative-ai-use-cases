import json
import os
import traceback
from typing import List, Dict, Any
import litellm
from litellm import completion

# LiteLLMの設定
litellm.drop_params = True  # サポートされていないパラメータを自動的に削除
litellm.set_verbose = os.environ.get("LITELLM_VERBOSE", "false").lower() == "true"

def convert_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    アプリケーションのメッセージ形式をLiteLLMの形式に変換
    """
    converted_messages = []
    
    for msg in messages:
        # roleとcontentの基本的な変換
        converted_msg = {
            "role": msg.get("role", "user"),
            "content": []
        }
        
        # contentの処理
        content = msg.get("content", "")
        
        # 画像やその他のメディアがある場合の処理
        if "extraData" in msg and msg["extraData"]:
            for extra in msg["extraData"]:
                if extra.get("type") == "image":
                    # 画像データをLiteLLMの形式に変換
                    image_data = extra.get("source", {}).get("data", "")
                    if image_data:
                        converted_msg["content"].append({
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{extra['source'].get('mediaType', 'image/jpeg')};base64,{image_data}"
                            }
                        })
        
        # テキストコンテンツを追加
        if content:
            if isinstance(converted_msg["content"], list):
                converted_msg["content"].append({
                    "type": "text",
                    "text": content
                })
            else:
                converted_msg["content"] = content
        
        # contentが空のリストの場合は文字列に変換
        if isinstance(converted_msg["content"], list) and len(converted_msg["content"]) == 0:
            converted_msg["content"] = ""
        elif isinstance(converted_msg["content"], list) and len(converted_msg["content"]) == 1:
            # 単一のテキストメッセージの場合は文字列に変換
            if converted_msg["content"][0].get("type") == "text":
                converted_msg["content"] = converted_msg["content"][0]["text"]
        
        converted_messages.append(converted_msg)
    
    return converted_messages

def get_model_name(model: Dict[str, Any]) -> str:
    """
    モデル設定からLiteLLM用のモデル名を取得
    """
    model_id = model.get("modelId", "")
    
    # モデルIDがプロバイダー名を含む場合はそのまま使用
    # 例: "gpt-4", "claude-3-opus-20240229", "gemini-pro"
    if "/" in model_id:
        # プロバイダー/モデル形式の場合
        return model_id
    
    # プロバイダーを推定してプレフィックスを追加
    if model_id.startswith("gpt"):
        return f"openai/{model_id}"
    elif "claude" in model_id:
        return f"anthropic/{model_id}"
    elif "gemini" in model_id:
        return f"gemini/{model_id}"
    elif "llama" in model_id or "mistral" in model_id:
        # HuggingFaceやその他のプロバイダー
        return f"together/{model_id}"
    else:
        # デフォルトはOpenAI互換
        return model_id

def invoke_model(model: Dict[str, Any], messages: List[Dict[str, Any]], request_id: str) -> Dict[str, Any]:
    """
    LiteLLMを使用してモデルを呼び出し（非ストリーミング）
    """
    try:
        # メッセージを変換
        converted_messages = convert_messages(messages)
        
        # モデル名を取得
        model_name = get_model_name(model)
        
        # モデルパラメータの取得
        model_params = model.get("modelParameters", {})
        
        # LiteLLMで推論実行
        response = completion(
            model=model_name,
            messages=converted_messages,
            temperature=model_params.get("temperature", 0.7),
            max_tokens=model_params.get("max_tokens", 2048),
            top_p=model_params.get("top_p", 1.0),
            stream=False,
            metadata={
                "request_id": request_id
            }
        )
        
        # レスポンスの整形
        content = response.choices[0].message.content if response.choices else ""
        finish_reason = response.choices[0].finish_reason if response.choices else "stop"
        
        # finish_reasonをアプリケーションの形式に変換
        stop_reason_map = {
            "stop": "end_turn",
            "length": "max_tokens",
            "content_filter": "content_filter",
            "tool_calls": "tool_use",
            "function_call": "tool_use"
        }
        stop_reason = stop_reason_map.get(finish_reason, "end_turn")
        
        return {
            "content": content,
            "stopReason": stop_reason,
            "usage": {
                "inputTokens": response.usage.prompt_tokens if response.usage else 0,
                "outputTokens": response.usage.completion_tokens if response.usage else 0,
                "totalTokens": response.usage.total_tokens if response.usage else 0
            }
        }
        
    except Exception as e:
        print(f"Error in invoke_model: {str(e)}")
        print(traceback.format_exc())
        raise

def invoke_model_stream(model: Dict[str, Any], messages: List[Dict[str, Any]], request_id: str) -> Dict[str, Any]:
    """
    LiteLLMを使用してモデルを呼び出し（ストリーミング）
    注: Lambda関数では実際のストリーミングはできないため、
    チャンクに分割したレスポンスを返す
    """
    try:
        # メッセージを変換
        converted_messages = convert_messages(messages)
        
        # モデル名を取得
        model_name = get_model_name(model)
        
        # モデルパラメータの取得
        model_params = model.get("modelParameters", {})
        
        # LiteLLMで推論実行（ストリーミング）
        response = completion(
            model=model_name,
            messages=converted_messages,
            temperature=model_params.get("temperature", 0.7),
            max_tokens=model_params.get("max_tokens", 2048),
            top_p=model_params.get("top_p", 1.0),
            stream=True,
            metadata={
                "request_id": request_id
            }
        )
        
        # ストリーミングレスポンスを収集
        chunks = []
        full_content = ""
        stop_reason = "end_turn"
        
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta:
                delta = chunk.choices[0].delta
                if delta.content:
                    full_content += delta.content
                    chunks.append({
                        "content": delta.content,
                        "stopReason": None
                    })
                
                # 最後のチャンクの処理
                if chunk.choices[0].finish_reason:
                    finish_reason = chunk.choices[0].finish_reason
                    stop_reason_map = {
                        "stop": "end_turn",
                        "length": "max_tokens",
                        "content_filter": "content_filter",
                        "tool_calls": "tool_use",
                        "function_call": "tool_use"
                    }
                    stop_reason = stop_reason_map.get(finish_reason, "end_turn")
        
        return {
            "chunks": chunks,
            "stopReason": stop_reason,
            "fullContent": full_content
        }
        
    except Exception as e:
        print(f"Error in invoke_model_stream: {str(e)}")
        print(traceback.format_exc())
        raise

def handler(event, context):
    """
    Lambda関数のメインハンドラー
    """
    try:
        # リクエストの解析
        action = event.get("action", "invoke")
        model = event.get("model", {})
        messages = event.get("messages", [])
        request_id = event.get("id", "")
        
        # アクションに応じて処理を分岐
        if action == "invoke":
            result = invoke_model(model, messages, request_id)
        elif action == "invoke_stream":
            result = invoke_model_stream(model, messages, request_id)
        else:
            raise ValueError(f"Unknown action: {action}")
        
        return {
            "statusCode": 200,
            "body": json.dumps(result)
        }
        
    except Exception as e:
        print(f"Error in handler: {str(e)}")
        print(traceback.format_exc())
        return {
            "statusCode": 500,
            "errorMessage": str(e),
            "body": json.dumps({
                "error": str(e),
                "type": type(e).__name__
            })
        }