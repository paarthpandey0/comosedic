import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Globe,
  Lock,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Target,
  Trash2,
  Users,
} from 'lucide-react';
import type { QuizQuestion, StudyRoom, UserProfile } from '../types';
import {
  createStudyRoom,
  deleteStudyRoom,
  joinStudyRoomById,
  updateStudyRoom,
} from '../services/studyDb';
import { generateQuiz } from '../services/geminiApi';

interface StudyRoomsViewProps {
  uid: string;
  profile: UserProfile | null;
  rooms: StudyRoom[];
}

interface ChatMsg {
  id: string;
  uid: string;
  displayName: string;
  text: string;
  timestamp: string;
}

interface SharedStroke {
  color: string;
  points: Array<{ x: number; y: number }>;
}

export function StudyRoomsView({ uid, profile, rooms }: StudyRoomsViewProps) {
  const [selectedRoomId, setSelectedRoomId] = useState<string>(rooms[0]?.id || '');
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomSubject, setNewRoomSubject] = useState('');
  const [newRoomGoal, setNewRoomGoal] = useState('');
  const [newIsPublic, setNewIsPublic] = useState(true);
  const [joinCodeInput, setJoinCodeInput] = useState('');

  const [onlinePeers, setOnlinePeers] = useState<Array<{ uid: string; displayName: string }>>([]);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [mindNodeInput, setMindNodeInput] = useState('');
  const [activeTab, setActiveTab] = useState<'notes' | 'whiteboard' | 'quiz' | 'mindmap'>('notes');
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [error, setError] = useState('');
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [strokes, setStrokes] = useState<SharedStroke[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const isRemoteNotesRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ active: boolean; current: SharedStroke | null }>({ active: false, current: null });

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) || rooms[0] || null,
    [rooms, selectedRoomId]
  );

  // Keep notesDraft synced with Firestore updates without echo loops
  useEffect(() => {
    if (!activeRoom) return;
    isRemoteNotesRef.current = true;
    setNotesDraft(activeRoom.sharedNotes || '');
  }, [activeRoom?.id, activeRoom?.sharedNotes]);

  // Connect real-time WebSocket hub (/ws/study-room) when entering a room
  useEffect(() => {
    if (!activeRoom) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/study-room`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'join',
          roomId: activeRoom.id,
          uid,
          displayName: profile?.displayName || 'Scholar',
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'presence' && Array.isArray(msg.members)) {
          setOnlinePeers(msg.members);
        } else if (msg.type === 'chat') {
          setChatMessages((prev) => [...prev.slice(-60), msg]);
        } else if (msg.type === 'stroke' && msg.stroke) {
          setStrokes((prev) => [...prev, msg.stroke as SharedStroke]);
        } else if (msg.type === 'clear_board') {
          setStrokes([]);
        }
      } catch {
        // ignore invalid messages
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setOnlinePeers([]);
    };
  }, [activeRoom?.id, uid, profile?.displayName]);

  // Redraw shared canvas when strokes update
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) {
      if (!s.points?.length) continue;
      ctx.strokeStyle = s.color || '#4f46e5';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x, s.points[i].y);
      }
      ctx.stroke();
    }
  }, [strokes, activeTab]);

  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) {
      setError('Enter a room name.');
      return;
    }
    setError('');
    try {
      const id = await createStudyRoom(uid, {
        name: newRoomName.trim(),
        subjectName: newRoomSubject.trim() || 'General Study',
        isPublic: newIsPublic,
        sharedGoal: newRoomGoal.trim() || 'Master key exam questions together.',
      });
      setSelectedRoomId(id);
      setNewRoomName('');
      setNewRoomSubject('');
      setNewRoomGoal('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room.');
    }
  };

  const handleJoinByIdOrCode = async () => {
    const input = joinCodeInput.trim();
    if (!input) return;
    setError('');
    const matched = rooms.find(
      (r) => r.id === input || r.inviteCode.toUpperCase() === input.toUpperCase()
    );
    if (matched) {
      await joinStudyRoomById(uid, matched.id);
      setSelectedRoomId(matched.id);
      setJoinCodeInput('');
      return;
    }
    const ok = await joinStudyRoomById(uid, input);
    if (ok) {
      setSelectedRoomId(input);
      setJoinCodeInput('');
    } else {
      setError('Room not found. Enter a valid Room ID or visible Invite Code.');
    }
  };

  const handleSaveNotes = async () => {
    if (!activeRoom) return;
    isRemoteNotesRef.current = false;
    await updateStudyRoom(activeRoom.id, { sharedNotes: notesDraft });
  };

  const handleSendChat = () => {
    if (!chatInput.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({
        type: 'chat',
        roomId: activeRoom?.id,
        uid,
        displayName: profile?.displayName || 'Scholar',
        text: chatInput.trim(),
      })
    );
    setChatInput('');
  };

  const handleStartGroupQuiz = async () => {
    if (!activeRoom) return;
    setGeneratingQuiz(true);
    setError('');
    try {
      const res = await generateQuiz({
        subjectName: activeRoom.subjectName,
        resourcesText: activeRoom.sharedNotes || activeRoom.subjectName,
        count: 4,
        difficulty: 'standard',
        questionTypes: ['mcq'],
        pastWeakTopics: [],
      });
      await updateStudyRoom(activeRoom.id, {
        quizSessionJson: JSON.stringify({
          title: res.title,
          questions: res.questions,
          answersByUser: {},
        }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate group quiz.');
    } finally {
      setGeneratingQuiz(false);
    }
  };

  const parsedQuiz = useMemo<{
    title?: string;
    questions?: QuizQuestion[];
    answersByUser?: Record<string, Record<string, string>>;
  }>(() => {
    if (!activeRoom?.quizSessionJson) return {};
    try {
      return JSON.parse(activeRoom.quizSessionJson);
    } catch {
      return {};
    }
  }, [activeRoom?.quizSessionJson]);

  const handleAnswerGroupQuiz = async (qId: string, opt: string) => {
    if (!activeRoom || !parsedQuiz.questions) return;
    const nextAnswers = {
      ...(parsedQuiz.answersByUser || {}),
      [uid]: {
        ...((parsedQuiz.answersByUser || {})[uid] || {}),
        [qId]: opt,
      },
    };
    await updateStudyRoom(activeRoom.id, {
      quizSessionJson: JSON.stringify({ ...parsedQuiz, answersByUser: nextAnswers }),
    });
  };

  const handleAddMindNode = async () => {
    if (!activeRoom || !mindNodeInput.trim()) return;
    const node = {
      id: `rm_${Date.now()}`,
      text: mindNodeInput.trim().slice(0, 120),
      author: profile?.displayName || 'Scholar',
    };
    await updateStudyRoom(activeRoom.id, {
      mindMapNodes: [...(activeRoom.mindMapNodes || []), node].slice(0, 40),
    });
    setMindNodeInput('');
  };

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
          <Users className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          Collaborative Study Rooms
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Real-time WebSocket &amp; Firestore study spaces with live peers, shared notes, shared whiteboard, group quizzes, and collaborative concept boards.
        </p>
      </div>

      {/* Create or Join Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <input
            type="text"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            placeholder="Room name"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
          />
          <input
            type="text"
            value={newRoomSubject}
            onChange={(e) => setNewRoomSubject(e.target.value)}
            placeholder="Subject (e.g. Biology)"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
          />
          <button
            type="button"
            onClick={() => setNewIsPublic((p) => !p)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            {newIsPublic ? <Globe className="w-3.5 h-3.5 text-emerald-600" /> : <Lock className="w-3.5 h-3.5 text-amber-600" />}
            {newIsPublic ? 'Public Room' : 'Invite-Only'}
          </button>
          <button
            type="button"
            onClick={() => void handleCreateRoom()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Room
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 flex gap-2">
          <input
            type="text"
            value={joinCodeInput}
            onChange={(e) => setJoinCodeInput(e.target.value)}
            placeholder="Paste Room ID or Invite Code"
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
          />
          <button
            type="button"
            onClick={() => void handleJoinByIdOrCode()}
            className="px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-indigo-600 text-white text-xs font-medium"
          >
            Join
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl bg-rose-50 px-4 py-2.5 text-xs text-rose-700">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Room Selector */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 space-y-2 h-fit">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Available Rooms</p>
          {rooms.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">Create a study room to collaborate live.</p>
          ) : (
            rooms.map((r) => (
              <div key={r.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedRoomId(r.id)}
                  className={`flex-1 text-left px-3 py-2 rounded-xl text-xs transition-colors ${
                    activeRoom?.id === r.id
                      ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="block truncate">{r.name}</span>
                  <span className="block text-[10px] opacity-70">
                    {r.subjectName} · {r.isPublic ? 'Public' : 'Private'}
                  </span>
                </button>
                {r.ownerId === uid && (
                  <button
                    type="button"
                    onClick={() => void deleteStudyRoom(r.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600"
                    aria-label="Delete room"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Active Room Canvas */}
        {activeRoom && (
          <div className="lg:col-span-3 space-y-4">
            {/* Room Header */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">{activeRoom.name}</h2>
                <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                  <Target className="w-3.5 h-3.5 text-indigo-600" />
                  Goal: {activeRoom.sharedGoal}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  {onlinePeers.length} online ({onlinePeers.map((p) => p.displayName).join(', ') || 'You'})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(activeRoom.id);
                    setCopiedInvite(true);
                    setTimeout(() => setCopiedInvite(false), 1800);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono"
                >
                  <Copy className="w-3 h-3" />
                  {copiedInvite ? 'Copied Room ID' : `Code: ${activeRoom.inviteCode}`}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Collaborative Workspace Tabs */}
              <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 space-y-4">
                <div className="flex flex-wrap gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  {(
                    [
                      { id: 'notes', label: 'Shared Notes' },
                      { id: 'whiteboard', label: 'Live Whiteboard' },
                      { id: 'quiz', label: 'Group Quiz' },
                      { id: 'mindmap', label: 'Shared Concept Board' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                        activeTab === t.id
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {activeTab === 'notes' && (
                  <div className="space-y-3">
                    <textarea
                      rows={11}
                      value={notesDraft}
                      onChange={(e) => {
                        isRemoteNotesRef.current = false;
                        setNotesDraft(e.target.value);
                      }}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 text-xs font-mono text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveNotes()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-medium"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Sync Shared Notes
                    </button>
                  </div>
                )}

                {activeTab === 'whiteboard' && (
                  <div className="space-y-2">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setStrokes([]);
                          wsRef.current?.send(JSON.stringify({ type: 'clear_board', roomId: activeRoom.id }));
                        }}
                        className="text-xs text-rose-600 hover:underline"
                      >
                        Clear Shared Board
                      </button>
                    </div>
                    <canvas
                      ref={canvasRef}
                      width={640}
                      height={360}
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        const pt = pointerPos(e);
                        drawingRef.current = { active: true, current: { color: '#4f46e5', points: [pt] } };
                      }}
                      onPointerMove={(e) => {
                        if (!drawingRef.current.active || !drawingRef.current.current) return;
                        drawingRef.current.current.points.push(pointerPos(e));
                        setStrokes((prev) => [...prev.slice(0, -1), { ...drawingRef.current.current! }]);
                      }}
                      onPointerUp={() => {
                        if (!drawingRef.current.active || !drawingRef.current.current) return;
                        const finished = drawingRef.current.current;
                        drawingRef.current = { active: false, current: null };
                        setStrokes((prev) => [...prev, finished]);
                        if (wsRef.current?.readyState === WebSocket.OPEN) {
                          wsRef.current.send(
                            JSON.stringify({ type: 'stroke', roomId: activeRoom.id, stroke: finished })
                          );
                        }
                      }}
                      className="w-full h-auto border border-slate-200 rounded-xl touch-none cursor-crosshair bg-white"
                    />
                  </div>
                )}

                {activeTab === 'quiz' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {parsedQuiz.title || 'Collaborative Room Quiz'}
                      </p>
                      <button
                        type="button"
                        disabled={generatingQuiz}
                        onClick={() => void handleStartGroupQuiz()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {generatingQuiz ? 'Generating...' : 'Launch New Group Quiz'}
                      </button>
                    </div>
                    {(parsedQuiz.questions || []).map((q, idx) => {
                      const myAnswer = parsedQuiz.answersByUser?.[uid]?.[q.id];
                      return (
                        <div key={q.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">
                            {idx + 1}. {q.prompt}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {q.options.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => void handleAnswerGroupQuiz(q.id, opt)}
                                className={`px-2.5 py-1.5 rounded-lg border text-left text-xs ${
                                  myAnswer === opt
                                    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 font-semibold'
                                    : 'border-slate-200 dark:border-slate-700'
                                }`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                          {myAnswer && (
                            <p className="text-[11px] text-slate-500">
                              {myAnswer === q.correctAnswer ? '✓ Correct' : `Answer: ${q.correctAnswer}`}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {activeTab === 'mindmap' && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={mindNodeInput}
                        onChange={(e) => setMindNodeInput(e.target.value)}
                        placeholder="Add shared concept or key definition..."
                        className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddMindNode()}
                        className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-medium"
                      >
                        Add Node
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(activeRoom.mindMapNodes || []).map((n) => (
                        <div key={n.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">{n.text}</p>
                          <p className="text-[10px] text-slate-400 mt-1">Added by {n.author}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Real-Time Room Chat */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 flex flex-col gap-3 h-[430px]">
                <p className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
                  Live Group Chat
                </p>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {chatMessages.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8">
                      Messages stream live via WebSocket to everyone in this room.
                    </p>
                  ) : (
                    chatMessages.map((m) => (
                      <div key={m.id} className="rounded-xl bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">{m.displayName}: </span>
                        <span className="text-slate-700 dark:text-slate-200">{m.text}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSendChat();
                    }}
                    placeholder="Message group..."
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleSendChat}
                    className="p-2 rounded-xl bg-indigo-600 text-white"
                    aria-label="Send message"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
