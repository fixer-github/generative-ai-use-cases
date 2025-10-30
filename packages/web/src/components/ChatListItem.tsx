import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BaseProps } from '../@types/common';
import { Link } from 'react-router-dom';
import { PiChat, PiCheck, PiPencilLine, PiTrash, PiX } from 'react-icons/pi';
import ButtonIcon from './ButtonIcon';
import { Chat } from 'generative-ai-use-cases';
import { decomposeId } from '../utils/ChatUtils';
import DialogConfirmDeleteChat from './DialogConfirmDeleteChat';

type Props = BaseProps & {
  active: boolean;
  chat: Chat;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDelete: (chatId: string) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdateTitle: (chatId: string, title: string) => Promise<any>;
  highlightWords: string[];
};

const ChatListItem: React.FC<Props> = (props) => {
  const [openDialog, setOpenDialog] = useState(false);
  const [editing, setEditing] = useState(false);
  const chatId = useMemo(() => {
    return decomposeId(props.chat.chatId) ?? '';
  }, [props.chat.chatId]);

  const inputRef = useRef<HTMLInputElement>(null);
  const [tempTitle, setTempTitle] = useState('');

  useEffect(() => {
    if (editing) {
      setTempTitle(props.chat.title);
    }
  }, [editing, props.chat.title]);

  const updateTitle = useCallback(() => {
    setEditing(false);
    props.onUpdateTitle(chatId, tempTitle).catch(() => {
      setEditing(true);
    });
  }, [chatId, props, tempTitle]);

  useLayoutEffect(() => {
    if (editing) {
      const listener = (e: DocumentEventMap['keypress']) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();

          // Update Title in dispatch process (to synchronize)
          setTempTitle((newTitle) => {
            setEditing(false);
            props.onUpdateTitle(chatId, newTitle).catch(() => {
              setEditing(true);
            });
            return newTitle;
          });
        }
      };
      inputRef.current?.addEventListener('keypress', listener);

      inputRef.current?.focus();

      return () => {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        inputRef.current?.removeEventListener('keypress', listener);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const highlightText = useCallback((text: string, words: string[]) => {
    if (words.length === 0) return text;

    const regex = new RegExp(`(${words.join('|')})`, 'gi');
    return text.split(regex).map((part, i) => {
      if (words.some((word) => part.toLowerCase() === word.toLowerCase())) {
        return (
          <span key={i} className="text-aws-smile">
            {part}
          </span>
        );
      }
      return part;
    });
  }, []);

  return (
    <>
      {openDialog && (
        <DialogConfirmDeleteChat
          isOpen={openDialog}
          target={props.chat}
          onDelete={() => {
            setOpenDialog(false);
            props.onDelete(chatId);
          }}
          onClose={() => {
            setOpenDialog(false);
          }}
        />
      )}
      <Link
        className={`group block w-full rounded-lg transition-colors ${
          props.active
            ? 'bg-blue-100 border border-blue-200'
            : 'hover:bg-gray-100'
        } ${props.className}`}
        to={`/chat/${chatId}`}>
        <div className="flex items-start gap-2 px-3 py-3">
          <div className="mt-0.5 flex-shrink-0">
            <PiChat
              size={16}
              className={props.active ? 'text-blue-600' : 'text-gray-400'}
            />
          </div>
          <div className="relative flex-1 min-w-0">
            {editing ? (
              <input
                ref={inputRef}
                type="text"
                className="w-full bg-transparent p-0 text-sm font-medium ring-0 text-gray-900 focus:outline-none"
                value={tempTitle}
                onChange={(e) => {
                  setTempTitle(e.target.value);
                }}
              />
            ) : (
              <div
                className={`text-sm font-medium truncate ${
                  props.active ? 'text-blue-900' : 'text-gray-900'
                }`}>
                {highlightText(props.chat.title, props.highlightWords)}
              </div>
            )}
          </div>
          <div className="flex">
            {props.active && !editing && (
              <>
                <ButtonIcon
                  onClick={() => {
                    setEditing(true);
                  }}>
                  <PiPencilLine />
                </ButtonIcon>
                <ButtonIcon
                  onClick={() => {
                    setOpenDialog(true);
                  }}>
                  <PiTrash />
                </ButtonIcon>
              </>
            )}
            {editing && (
              <>
                <ButtonIcon className="text-base" onClick={updateTitle}>
                  <PiCheck />
                </ButtonIcon>

                <ButtonIcon
                  className="text-base"
                  onClick={() => {
                    setEditing(false);
                  }}>
                  <PiX />
                </ButtonIcon>
              </>
            )}
          </div>
        </div>
      </Link>
    </>
  );
};

export default ChatListItem;
