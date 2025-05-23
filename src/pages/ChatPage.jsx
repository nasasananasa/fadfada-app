import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatType, setChatType] = useState('default');
  const [userId, setUserId] = useState(null);
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingChatTitle, setEditingChatTitle] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      const session = await supabase.auth.getSession();
      const user = session.data?.session?.user;
      if (user) {
        setUserId(user.id);
        fetchChats(user.id);
      }
    };
    fetchUser();
  }, [showArchived]);

  const fetchChats = async (uid) => {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    if (!error && data.length > 0) {
      const filtered = data.filter(c => (showArchived ? c.archived === true : c.archived !== true));
      setChats(filtered);
      if (filtered.length > 0) {
        setCurrentChatId(filtered[0].id);
        fetchMessages(filtered[0].id);
      } else {
        setCurrentChatId(null);
        setMessages([]);
      }
    }
  };

  const fetchMessages = async (chatId) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (!error) {
      setMessages(data.filter(m => typeof m.content === 'string' && m.content.trim() !== ''));
    }
  };

  const sendMessage = async () => {
    try {
      const session = await supabase.auth.getSession();
      const user = session.data?.session?.user;
      if (!user || !input.trim()) return;

      const trimmedInput = input.trim();
      let chatId = currentChatId;
      let currentMessageType = chatType;

      if (!chatId) {
        const { data, error } = await supabase
          .from('chats')
          .insert([{ user_id: user.id, archived: false, type: chatType }])
          .select();
        if (error || !data || data.length === 0) return;
        chatId = data[0].id;
        setCurrentChatId(chatId);
        setChats((prev) => [data[0], ...prev]);
      }

      if (chatType === 'therapy') {
        try {
          const res = await fetch("/api/openai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: trimmedInput,
              mode: "analyze"
            })
          });
          const data = await res.json();
          if (data.therapy) {
            currentMessageType = 'therapy';
            await supabase.from('chats').update({ type: 'therapy' }).eq('id', chatId);
            setChatType('therapy');
          }
        } catch (err) {
          console.error("❌ تحليل الرسالة فشل:", err.message);
        }
      }

      const userMessage = {
        content: trimmedInput,
        user_id: user.id,
        role: 'user',
        chat_type: currentMessageType,
        chat_id: chatId
      };

      const { error: insertError } = await supabase.from('messages').insert([userMessage]);
      if (!insertError) {
        setMessages((prev) => [...prev, { ...userMessage, created_at: new Date().toISOString() }]);
        setInput('');
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: currentMessageType === 'therapy' ? "gpt-4" : "gpt-3.5-turbo",
          messages: [{ role: "user", content: trimmedInput }]
        })
      });

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || data.reply;

      if (reply) {
        const assistantMessage = {
          content: reply,
          user_id: user.id,
          role: 'assistant',
          chat_type: currentMessageType,
          chat_id: chatId
        };
        await supabase.from('messages').insert([assistantMessage]);
        setMessages((prev) => [...prev, { ...assistantMessage, created_at: new Date().toISOString() }]);
      }

    } catch (err) {
      console.error("❌ خطأ في إرسال الرسالة:", err.message);
    }
  };

  const archiveChat = async (chatId) => {
    await supabase.from('chats').update({ archived: true }).eq('id', chatId);
    setChats(chats.filter(chat => chat.id !== chatId));
    if (chatId === currentChatId) {
      setCurrentChatId(null);
      setMessages([]);
    }
  };

  const deleteChat = async (chatId) => {
    const confirm = window.confirm("هل أنت متأكد أنك تريد حذف هذه المحادثة نهائيًا؟");
    if (!confirm) return;
    await supabase.from('chats').delete().eq('id', chatId);
    setChats(chats.filter(chat => chat.id !== chatId));
    if (chatId === currentChatId && chats.length > 1) {
      const next = chats.find(c => c.id !== chatId);
      if (next) {
        setCurrentChatId(next.id);
        fetchMessages(next.id);
      }
    } else if (chats.length === 1) {
      setCurrentChatId(null);
      setMessages([]);
    }
  };

  const updateChatTitle = async (chatId, title) => {
    await supabase.from('chats').update({ title }).eq('id', chatId);
    const updatedChats = chats.map(chat => chat.id === chatId ? { ...chat, title } : chat);
    setChats(updatedChats);
    setEditingChatId(null);
    setEditingChatTitle('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col md:flex-row p-4 max-w-6xl mx-auto gap-4">
      <div className="md:w-1/4 bg-gray-100 dark:bg-gray-900 p-4 rounded overflow-y-auto max-h-[500px]">
        <div className="mb-4">
          <button
            onClick={() => {
              setIsCreating(true);
              setMessages([]);
              setCurrentChatId(null);
            }}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded mb-2"
          >
            ➕ إنشاء محادثة
          </button>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="w-full py-1 px-4 bg-gray-700 text-white rounded text-sm"
          >
            {showArchived ? '👁️ عرض النشطة فقط' : '📦 عرض المؤرشفة'}
          </button>
        </div>

        {chats.map((chat) => (
          <div key={chat.id} className={`mb-2 p-2 rounded ${chat.id === currentChatId ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800'}`}>
            <div className="flex justify-between items-center">
              <div className="flex-1">
                {editingChatId === chat.id ? (
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={editingChatTitle}
                      onChange={(e) => setEditingChatTitle(e.target.value)}
                      className="w-full p-1 rounded border dark:bg-gray-800 dark:text-white"
                    />
                    <button
                      onClick={() => updateChatTitle(chat.id, editingChatTitle)}
                      className="text-xs bg-green-600 text-white px-2 rounded"
                    >💾</button>
                  </div>
                ) : (
                  <span
                    onClick={() => {
                      setCurrentChatId(chat.id);
                      fetchMessages(chat.id);
                      setIsCreating(false);
                    }}
                    className="cursor-pointer"
                  >
                    {chat.title || 'بدون عنوان'}
                  </span>
                )}
              </div>
              <div className="ml-2 flex gap-1">
                {showArchived ? (
                  <button
                    onClick={async () => {
                      await supabase.from('chats').update({ archived: false }).eq('id', chat.id);
                      fetchChats(userId);
                    }}
                    className="text-xs bg-green-600 text-white px-2 rounded"
                  >📤</button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditingChatId(chat.id);
                        setEditingChatTitle(chat.title || '');
                      }}
                      className="text-xs bg-yellow-400 text-black px-2 rounded"
                    >✏️</button>
                    <button
                      onClick={() => archiveChat(chat.id)}
                      className="text-xs bg-gray-400 text-white px-2 rounded"
                    >📦</button>
                    <button
                      onClick={() => deleteChat(chat.id)}
                      className="text-xs bg-red-600 text-white px-2 rounded"
                    >🗑️</button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 space-y-4">
        {(currentChatId || isCreating) && (
          <>
            <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded h-96 overflow-y-auto">
              {messages.map((msg, index) => (
                <div key={index} className={`mb-2 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <span className="inline-block px-3 py-2 rounded bg-white dark:bg-gray-700 whitespace-pre-wrap">
                    {msg.content}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full p-2 rounded border dark:bg-gray-900 dark:text-white"
                placeholder="اكتب رسالتك..."
                rows={2}
              />
              <button onClick={sendMessage} className="bg-blue-600 text-white px-4 rounded">
                إرسال
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
