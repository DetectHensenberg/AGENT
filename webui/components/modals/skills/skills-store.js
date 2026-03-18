import { createStore } from "/js/AlpineStore.js";

const model = {
  // State
  isLoading: false,
  skillsData: null,  // 使用对象包装数组
  selectedSkills: [],
  searchQuery: "",
  error: null,
  closePromise: null,

  // Computed: filtered skills
  get filteredSkills() {
    if (!this.skillsData?.items) return [];
    if (!this.searchQuery) return this.skillsData.items;
    const q = this.searchQuery.toLowerCase();
    return this.skillsData.items.filter(skill => {
      const searchable = `${skill.name} ${skill.description} ${(skill.tags || []).join(' ')}`.toLowerCase();
      return searchable.includes(q);
    });
  },

  // Open Skills modal
  async open() {
    if (this.isLoading) return;
    
    this.isLoading = true;
    this.error = null;
    this.skillsData = null;
    this.searchQuery = "";

    try {
      // Fetch skills from backend FIRST
      const response = await window.sendJsonData('/skills_list', {});
      const skillsArray = response.skills || [];
      
      // 使用对象包装确保响应式
      this.skillsData = { items: skillsArray, count: skillsArray.length };
      this.isLoading = false;

      // Open modal AFTER data is ready
      this.closePromise = window.openModal('modals/skills/skills.html');
      
      if (this.closePromise && typeof this.closePromise.then === 'function') {
        this.closePromise.then(() => {
          this.destroy();
        });
      }
      
    } catch (error) {
      console.error("Skills fetch error:", error);
      this.error = error?.message || "加载技能列表失败";
      this.isLoading = false;
      this.closePromise = window.openModal('modals/skills/skills.html');
    }
  },

  // Search/filter skills
  search(query) {
    this.searchQuery = query;
  },

  // Toggle skill selection
  toggleSkill(skill) {
    const index = this.selectedSkills.findIndex(s => s.name === skill.name);
    if (index >= 0) {
      this.selectedSkills.splice(index, 1);
    } else {
      this.selectedSkills.push(skill);
    }
  },

  // Check if skill is selected
  isSelected(skill) {
    return this.selectedSkills.some(s => s.name === skill.name);
  },

  // Apply selected skills
  async applySkills() {
    if (this.selectedSkills.length === 0) {
      window.closeModal();
      return;
    }

    try {
      // Load skills into context
      const response = await window.sendJsonData('/skills_load', {
        context: window.getContext(),
        skills: this.selectedSkills.map(s => s.name),
      });

      // Build prompt hint from skills
      const hints = this.selectedSkills.map(s => {
        return `【${s.name}】${s.description}`;
      }).join('\n');

      // Set input placeholder or prepend hint
      const inputStore = Alpine.store('chatInput');
      if (inputStore) {
        const currentText = inputStore.text || '';
        const prefix = `[已加载技能: ${this.selectedSkills.map(s => s.name).join(', ')}]\n`;
        if (!currentText.includes('[已加载技能:')) {
          inputStore.text = prefix + currentText;
        }
      }

      // Show toast
      window.showToast?.('技能已加载', `已加载 ${this.selectedSkills.length} 个技能`, 'success');
      
      window.closeModal();
      
    } catch (error) {
      console.error("Skills load error:", error);
      this.error = error?.message || "加载技能失败";
    }
  },

  // Clear selection
  clearSelection() {
    this.selectedSkills = [];
  },

  // Cleanup
  destroy() {
    this.skills = [];
    this.filteredSkills = [];
    this.selectedSkills = [];
    this.searchQuery = "";
    this.error = null;
  },
};

export const store = createStore("skills", model);
