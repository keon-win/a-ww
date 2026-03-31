import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy } from "firebase/firestore";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { db, auth } from "./firebase";

// 6 faces * 9 images per face = 54 images
const IMAGES = Array.from({ length: 54 }).map((_, i) => `https://picsum.photos/seed/${i + 800}/400/400`);

const CUBE_SIZE = 460;
const HALF_SIZE = CUBE_SIZE / 2;

const FACES = [
  { id: 'front', transform: `translateZ(${HALF_SIZE}px)` },
  { id: 'right', transform: `rotateY(90deg) translateZ(${HALF_SIZE}px)` },
  { id: 'top', transform: `rotateX(90deg) translateZ(${HALF_SIZE}px)` },
  { id: 'back', transform: `rotateY(180deg) translateZ(${HALF_SIZE}px)` },
  { id: 'left', transform: `rotateY(-90deg) translateZ(${HALF_SIZE}px)` },
  { id: 'bottom', transform: `rotateX(-90deg) translateZ(${HALF_SIZE}px)` },
];

export default function App() {
  const [windowSize, setWindowSize] = useState({ width: 1000, height: 800 });
  const [hoveredArticle, setHoveredArticle] = useState<number | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<number | null>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [editingArticleId, setEditingArticleId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newArticle, setNewArticle] = useState({ title: '', date: '', intro: '', content: '', quote: '', coverImage: '', contentImages: [] as string[] });
  const [isUploading, setIsUploading] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginAccount, setLoginAccount] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const compressImage = (file: File, maxWidth = 800): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ratio = Math.min(maxWidth / img.width, 1);
          canvas.width = img.width * ratio;
          canvas.height = img.height * ratio;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.6)); // Compress to 60% quality JPEG
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: 'coverImage' | 'contentImages') => {
    if (!e.target.files?.length) return;
    setIsUploading(true);
    try {
      if (field === 'coverImage') {
        const base64 = await compressImage(e.target.files[0]);
        setNewArticle(prev => ({ ...prev, coverImage: base64 }));
      } else {
        const files = Array.from(e.target.files).slice(0, 4); // Max 4 content images
        const base64Images = await Promise.all(files.map(f => compressImage(f)));
        setNewArticle(prev => ({ ...prev, contentImages: base64Images }));
      }
    } catch (error) {
      console.error("Image compression failed", error);
      alert("图片处理失败，请重试。");
    } finally {
      setIsUploading(false);
    }
  };

  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    const q = query(collection(db, "articles"), orderBy("createdAt", "desc"));
    const unsubscribeDb = onSnapshot(q, (snapshot) => {
      const fetchedArticles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const combined = fetchedArticles.map((a, i) => {
        const count = 4 + (i % 5);
        const indices = [];
        for(let j=0; j<count; j++) {
            indices.push((i * 7 + j * 13) % 54);
        }
        return { ...a, imageIndices: indices };
      });
      setArticles(combined);
    }, (error) => {
      console.error("Firestore Error:", error);
      setArticles([]);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeDb();
    };
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginAccount !== 'admin' || loginPassword !== '123456') {
      alert("账号或密码错误");
      return;
    }
    setLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, 'admin@system.local', '123456');
      setShowLoginModal(false);
      setLoginAccount('');
      setLoginPassword('');
    } catch (error: any) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        try {
          await createUserWithEmailAndPassword(auth, 'admin@system.local', '123456');
          setShowLoginModal(false);
          setLoginAccount('');
          setLoginPassword('');
        } catch (createError: any) {
          if (createError.code === 'auth/operation-not-allowed') {
            alert("请先在 Firebase 控制台的 Authentication 中启用“电子邮件/密码”登录方式！");
          } else {
            alert("登录失败: " + createError.message);
          }
        }
      } else if (error.code === 'auth/operation-not-allowed') {
        alert("请先在 Firebase 控制台的 Authentication 中启用“电子邮件/密码”登录方式！");
      } else {
        alert("登录失败: " + error.message);
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => signOut(auth);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      const articleData = {
        title: newArticle.title,
        date: newArticle.date,
        intro: newArticle.intro,
        content: newArticle.content,
        quote: newArticle.quote,
        ...(newArticle.coverImage && { coverImage: newArticle.coverImage }),
        ...(newArticle.contentImages.length > 0 && { contentImages: newArticle.contentImages }),
      };

      if (editingArticleId) {
        await updateDoc(doc(db, "articles", editingArticleId), articleData);
      } else {
        await addDoc(collection(db, "articles"), {
          ...articleData,
          authorId: user.uid,
          createdAt: serverTimestamp()
        });
      }
      setIsComposing(false);
      setEditingArticleId(null);
      setNewArticle({ title: '', date: '', intro: '', content: '', quote: '', coverImage: '', contentImages: [] });
    } catch (error) {
      console.error("Publish failed", error);
      alert("发布失败，请检查权限。");
    }
  };

  const executeDelete = async () => {
    if (!confirmDeleteId) return;
    try {
      await deleteDoc(doc(db, "articles", confirmDeleteId));
      setConfirmDeleteId(null);
      setSelectedArticle(null);
    } catch (error) {
      console.error("Delete failed", error);
      alert("删除失败，请检查权限。");
    }
  };

  useEffect(() => {
    setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX / window.innerWidth);
      mouseY.set(e.clientY / window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  // Base rotation to show Front, Top, and Right faces
  // Negative rotateX tilts the top face towards the viewer
  // Negative rotateY tilts the right face towards the viewer
  const rotateX = useSpring(useTransform(mouseY, [0, 1], [-10, -40]), { stiffness: 80, damping: 25 });
  const rotateY = useSpring(useTransform(mouseX, [0, 1], [-15, -55]), { stiffness: 80, damping: 25 });

  // Calculate scale based on screen width to ensure it fits between FW text and right sidebar
  // The cube needs more aggressive scaling on smaller screens to stay centered without overlapping
  const getScale = () => {
    const width = windowSize.width;
    if (width > 1400) return 1;
    if (width > 1200) return 0.85;
    if (width > 1000) return 0.7;
    if (width > 800) return 0.55;
    if (width > 600) return 0.45;
    return Math.max(0.25, width / 2000); // Very small screens (mobile)
  };
  
  const baseScale = getScale();

  return (
    <div className="relative w-screen h-screen bg-[#000000] text-[#888] overflow-hidden font-sans selection:bg-[#FF3300] selection:text-white">
      {/* Top Left Text */}
      <div className="hidden md:block absolute top-8 left-12 text-[11px] tracking-wider text-[#888] z-50">
        {windowSize.width}px × {windowSize.height}px
      </div>

      {/* Top Nav */}
      <nav className="absolute top-8 left-1/2 -translate-x-1/2 flex gap-2 text-[10px] md:text-[11px] tracking-widest z-50">
        <span className="text-white cursor-pointer">精选作品</span>
        <span className="text-[#888] cursor-pointer hover:text-white transition-colors">档案 , 关于</span>
      </nav>

      {/* Left Metadata */}
      <div className="absolute left-6 md:left-12 top-[15%] md:top-[50%] md:-translate-y-1/2 flex flex-col md:flex-row gap-4 md:gap-16 text-[10px] md:text-[11px] tracking-wider leading-relaxed z-20 mix-blend-difference text-[#888]">
        <div>
          <p className="mb-1">科伦丁·贝尔纳杜</p>
          <p>自由开发者</p>
        </div>
        <div>
          <p className="mb-1">期号: 003 / 系列: 2026</p>
          <p>参考编号: EDI-032026-R02</p>
        </div>
      </div>

      {/* Giant FW Text */}
      <div className="absolute bottom-[-2%] md:bottom-[-5%] left-6 md:left-12 z-0 pointer-events-none opacity-50 md:opacity-100">
        <h1 className="text-[40vw] md:text-[28vw] font-light text-[#FF3300] leading-none tracking-tighter m-0 p-0 select-none" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          FW
        </h1>
      </div>

      {/* Right Sidebar List */}
      <div 
        className="absolute right-2 md:right-6 top-0 h-full w-[120px] md:w-[280px] z-20 pointer-events-auto overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        style={{ maskImage: 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)' }}
      >
        <div className="flex flex-col text-[11px] md:text-[13px] tracking-widest py-[45vh]">
          {articles.map((article, i) => {
            const distance = hoveredArticle !== null ? Math.abs(hoveredArticle - i) : null;
            
            let scale = 1;
            let translateX = 0;
            let opacityClass = 'opacity-100';
            let colorClass = 'text-[#888]';

            if (distance !== null) {
              if (distance === 0) {
                scale = 1.15;
                translateX = 24;
                opacityClass = 'opacity-100';
                colorClass = 'text-[#FF3300] font-bold';
              } else if (distance === 1) {
                scale = 1.05;
                translateX = 12;
                opacityClass = 'opacity-60';
                colorClass = 'text-[#888]';
              } else if (distance === 2) {
                scale = 1.02;
                translateX = 4;
                opacityClass = 'opacity-40';
                colorClass = 'text-[#888]';
              } else {
                scale = 1;
                translateX = 0;
                opacityClass = 'opacity-20';
                colorClass = 'text-[#888]';
              }
            }

            return (
              <a 
                key={i} 
                href={article.link}
                onClick={(e) => {
                  e.preventDefault();
                  setSelectedArticle(i);
                }}
                onMouseEnter={() => setHoveredArticle(i)}
                onMouseLeave={() => setHoveredArticle(null)}
                className={`flex items-center justify-between py-2 w-full transition-all duration-300 ease-out cursor-pointer pointer-events-auto ${opacityClass}`}
              >
                <span 
                  className={`inline-block transition-all duration-300 ease-out origin-left ${colorClass}`}
                  style={{ transform: `translateX(${translateX}px) scale(${scale})` }}
                >
                  {article.title}
                </span>
              </a>
            );
          })}
        </div>
      </div>

      {/* Center 3D Rubik's Cube */}
      <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none" style={{ perspective: '1200px' }}>
        <motion.div
          style={{ 
            width: CUBE_SIZE,
            height: CUBE_SIZE,
            rotateX, 
            rotateY, 
            rotateZ: -8, // Slight tilt to match screenshot
            transformStyle: "preserve-3d" 
          }}
          animate={{
            scale: (hoveredArticle !== null ? 1.15 : 1) * baseScale,
            y: hoveredArticle !== null ? 0 : [0, -15, 0], // Subtle floating effect when not hovered
          }}
          transition={{
            scale: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
            y: { duration: 6, repeat: Infinity, ease: "easeInOut" } // Slow breathing animation
          }}
          className="relative"
        >
          {FACES.map((face, faceIndex) => (
            <div
              key={face.id}
              className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-6 bg-transparent"
              style={{
                transform: face.transform,
                transformStyle: "preserve-3d",
              }}
            >
              {Array.from({ length: 9 }).map((_, i) => {
                const imgIndex = faceIndex * 9 + i;
                const isHighlighted = hoveredArticle !== null && articles[hoveredArticle]?.imageIndices?.includes(imgIndex);
                const isDimmed = hoveredArticle !== null && !isHighlighted;

                return (
                  <div key={i} className="w-full h-full overflow-hidden relative">
                    <img 
                      src={IMAGES[imgIndex]} 
                      alt="" 
                      className={`w-full h-full object-cover transition-all duration-700 ease-out ${isDimmed ? 'opacity-10' : 'opacity-100'}`} 
                      referrerPolicy="no-referrer" 
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </motion.div>
      </div>

      {/* Article Modal */}
      <AnimatePresence>
        {selectedArticle !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8 bg-black/80 backdrop-blur-md"
            onClick={() => setSelectedArticle(null)}
          >
            <motion.div
              initial={{ y: 50, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-[#0a0a0a] border border-[#222] w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl p-8 md:p-12 text-[#ccc] relative shadow-2xl [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setSelectedArticle(null)}
                className="absolute top-6 right-6 text-[#888] hover:text-white transition-colors bg-[#111] hover:bg-[#222] p-2 rounded-full"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>

              {user && articles[selectedArticle].id && (
                <div className="absolute top-6 right-16 flex gap-2 mr-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const a = articles[selectedArticle];
                      setNewArticle({
                        title: a.title || '',
                        date: a.date || '',
                        intro: a.intro || '',
                        content: a.content || '',
                        quote: a.quote || '',
                        coverImage: a.coverImage || '',
                        contentImages: a.contentImages || []
                      });
                      setEditingArticleId(a.id);
                      setIsComposing(true);
                    }}
                    className="text-[#888] hover:text-white transition-colors bg-[#111] hover:bg-[#222] px-4 py-2 rounded-full text-xs font-bold"
                  >
                    编辑
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(articles[selectedArticle].id);
                    }}
                    className="text-[#888] hover:text-[#FF3300] transition-colors bg-[#111] hover:bg-[#222] px-4 py-2 rounded-full text-xs font-bold"
                  >
                    删除
                  </button>
                </div>
              )}

              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">{articles[selectedArticle].title}</h2>
              {articles[selectedArticle].date && (
                <div className="flex items-center gap-2 mb-8">
                  <div className="w-2 h-2 bg-[#FF3300]" />
                  <p className="text-[#888] text-sm tracking-wider">{articles[selectedArticle].date}</p>
                </div>
              )}

              <img
                src={articles[selectedArticle].coverImage || IMAGES[articles[selectedArticle].imageIndices[0]]}
                alt={articles[selectedArticle].title}
                className="w-full h-64 md:h-80 object-cover rounded-xl mb-10"
                referrerPolicy="no-referrer"
              />

              <div className="space-y-8 leading-relaxed text-[15px] md:text-[17px] text-[#aaa] font-serif">
                <p className="first-letter:text-5xl first-letter:font-bold first-letter:text-[#FF3300] first-letter:mr-3 first-letter:float-left">
                  <strong className="text-white font-sans">引言：</strong> {articles[selectedArticle].intro || `这是关于“${articles[selectedArticle].title}”的详细内容。在这里，您可以阅读到完整的文章、访谈或项目记录。`}
                </p>
                <p>
                  {articles[selectedArticle].content || "在未来的实际应用中，这里将通过 CMS（内容管理系统）或 Markdown 文件动态加载真实的博客内容。排版可以包含多张图片、引言、粗体文本等丰富的富文本格式。我们的设计旨在提供最纯粹的阅读体验。"}
                </p>
                <blockquote className="relative border-l-4 border-[#FF3300] pl-8 py-4 my-12 text-white italic text-xl md:text-2xl bg-gradient-to-r from-[#FF3300]/10 to-transparent rounded-r-xl">
                  <span className="absolute -top-4 -left-3 text-6xl text-[#FF3300] opacity-50 font-serif">"</span>
                  {articles[selectedArticle].quote || "设计理念：我们希望在保持首页极简和 3D 互动感的同时，为阅读提供一个沉浸、无干扰的环境。"}
                </blockquote>
                <p>
                  随着数字时代的发展，信息的呈现方式变得和信息本身一样重要。我们通过精心设计的排版、恰到好处的留白以及流畅的过渡动画，让每一次点击都成为一次愉悦的探索。
                </p>
                <div className="grid grid-cols-2 gap-4 mt-8">
                  {articles[selectedArticle].contentImages ? (
                    articles[selectedArticle].contentImages.map((img: string, idx: number) => (
                      <img key={idx} src={img} className="w-full h-40 object-cover rounded-lg" alt="" referrerPolicy="no-referrer" />
                    ))
                  ) : (
                    <>
                      <img src={IMAGES[articles[selectedArticle].imageIndices[1]]} className="w-full h-40 object-cover rounded-lg" alt="" referrerPolicy="no-referrer" />
                      <img src={IMAGES[articles[selectedArticle].imageIndices[2]]} className="w-full h-40 object-cover rounded-lg" alt="" referrerPolicy="no-referrer" />
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Controls */}
      <div className="absolute top-8 right-6 md:right-6 z-[50] flex gap-4">
        {user ? (
          <>
            <button onClick={() => setIsComposing(true)} className="text-xs text-white bg-[#FF3300] px-4 py-2 rounded-full hover:bg-[#e62e00] transition-colors">发布文章</button>
            <button onClick={handleLogout} className="text-xs text-[#888] hover:text-white transition-colors">退出登录</button>
          </>
        ) : (
          <button onClick={() => setShowLoginModal(true)} className="text-xs text-[#888] hover:text-white transition-colors">管理员登录</button>
        )}
      </div>

      {/* Compose Modal */}
      <AnimatePresence>
        {isComposing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="bg-[#111] border border-[#333] w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl p-6 md:p-8 text-white relative shadow-2xl [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            >
              <button onClick={() => {
                setIsComposing(false);
                setEditingArticleId(null);
                setNewArticle({ title: '', date: '', intro: '', content: '', quote: '', coverImage: '', contentImages: [] });
              }} className="absolute top-6 right-6 text-[#888] hover:text-white">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
              <h2 className="text-2xl font-bold mb-6">{editingArticleId ? '编辑文章' : '发布新文章'}</h2>
              <form onSubmit={handlePublish} className="space-y-4">
                <div>
                  <label className="block text-xs text-[#888] mb-1">头图 (可选)</label>
                  <input type="file" accept="image/*" onChange={e => handleImageUpload(e, 'coverImage')} className="w-full text-xs text-[#888] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-[#FF3300] file:text-white hover:file:bg-[#e62e00]" />
                  {newArticle.coverImage && <img src={newArticle.coverImage} alt="Cover Preview" className="mt-2 h-16 w-16 object-cover rounded-lg" />}
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">正文插图 (可选，最多4张)</label>
                  <input type="file" accept="image/*" multiple onChange={e => handleImageUpload(e, 'contentImages')} className="w-full text-xs text-[#888] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-[#333] file:text-white hover:file:bg-[#444]" />
                  {newArticle.contentImages.length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {newArticle.contentImages.map((img, idx) => (
                        <img key={idx} src={img} alt="Content Preview" className="h-12 w-12 object-cover rounded-lg" />
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">标题</label>
                  <input required value={newArticle.title} onChange={e => setNewArticle({...newArticle, title: e.target.value})} className="w-full bg-[#222] border border-[#444] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#FF3300]" />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">日期 (可选)</label>
                  <input value={newArticle.date} onChange={e => setNewArticle({...newArticle, date: e.target.value})} className="w-full bg-[#222] border border-[#444] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#FF3300]" />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">引言 (可选)</label>
                  <textarea value={newArticle.intro} onChange={e => setNewArticle({...newArticle, intro: e.target.value})} className="w-full bg-[#222] border border-[#444] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#FF3300] h-20" />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">正文 (可选)</label>
                  <textarea value={newArticle.content} onChange={e => setNewArticle({...newArticle, content: e.target.value})} className="w-full bg-[#222] border border-[#444] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#FF3300] h-32" />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">金句引用 (可选)</label>
                  <input value={newArticle.quote} onChange={e => setNewArticle({...newArticle, quote: e.target.value})} className="w-full bg-[#222] border border-[#444] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#FF3300]" />
                </div>
                <button type="submit" disabled={isUploading} className={`w-full ${isUploading ? 'bg-[#555]' : 'bg-[#FF3300] hover:bg-[#e62e00]'} text-white font-bold py-3 rounded-lg transition-colors mt-4`}>
                  {isUploading ? '图片处理中...' : (editingArticleId ? '保存修改' : '发布')}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm Delete Modal */}
      <AnimatePresence>
        {confirmDeleteId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-[#111] border border-[#333] w-full max-w-sm rounded-2xl p-8 text-center shadow-2xl"
            >
              <h3 className="text-xl font-bold text-white mb-4">确认删除</h3>
              <p className="text-[#888] mb-8 text-sm">删除后无法恢复，确定要删除这篇文章吗？</p>
              <div className="flex gap-4 justify-center">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-6 py-2 rounded-full bg-[#222] text-white hover:bg-[#333] transition-colors text-sm"
                >
                  取消
                </button>
                <button
                  onClick={executeDelete}
                  className="px-6 py-2 rounded-full bg-[#FF3300] text-white hover:bg-[#e62e00] transition-colors text-sm"
                >
                  确认删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showLoginModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#111] border border-[#333] p-8 rounded-2xl w-full max-w-sm"
            >
              <h2 className="text-xl text-white mb-6 font-medium">管理员登录</h2>
              <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs text-[#888] mb-1">账号</label>
                  <input 
                    type="text" 
                    value={loginAccount}
                    onChange={e => setLoginAccount(e.target.value)}
                    className="w-full bg-[#222] text-white px-4 py-2 rounded-lg outline-none focus:ring-1 focus:ring-[#FF3300] transition-all"
                    placeholder="请输入账号"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">密码</label>
                  <input 
                    type="password" 
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    className="w-full bg-[#222] text-white px-4 py-2 rounded-lg outline-none focus:ring-1 focus:ring-[#FF3300] transition-all"
                    placeholder="请输入密码"
                    required
                  />
                </div>
                <div className="flex justify-end gap-3 mt-4">
                  <button 
                    type="button"
                    onClick={() => setShowLoginModal(false)}
                    className="px-4 py-2 text-sm text-[#888] hover:text-white transition-colors"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    disabled={loginLoading}
                    className="px-4 py-2 text-sm bg-[#FF3300] text-white rounded-lg hover:bg-[#e62e00] transition-colors disabled:opacity-50"
                  >
                    {loginLoading ? '登录中...' : '登录'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
