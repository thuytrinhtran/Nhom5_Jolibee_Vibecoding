const {test}=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {Toast,errorGuidance}=require('./helpers/ui-components.cjs');
test('success feedback is non-modal, escaped, dismissible and never captures focus',()=>{
 let dismissed=0;const tree=Toast({message:'Saved <script>unsafe</script>',onDismiss:()=>dismissed++});
 const html=renderToStaticMarkup(tree);assert.equal(tree.props.role,'status');assert.ok(html.includes('aria-live="polite"'));assert.ok(!html.includes('role="dialog"'));assert.ok(!html.includes('autofocus'));assert.ok(!html.includes('<script>'));
 const walk=node=>!React.isValidElement(node)?[]:[node,...React.Children.toArray(node.props.children).flatMap(walk)];
 walk(tree).find(n=>n.type==='button').props.onClick();assert.equal(dismissed,1);
});
test('known API failures explain recovery while specific unknown messages remain intact',()=>{
 assert.ok(!errorGuidance('Cannot process: FEEDBACK_CLOSED').includes('FEEDBACK_CLOSED'));
 assert.ok(!errorGuidance('STALE_SCHEDULE_VERSION').includes('STALE_SCHEDULE_VERSION'));
 assert.equal(errorGuidance('Please contact your branch manager.'),'Please contact your branch manager.');
 assert.equal(errorGuidance('Not_FEEDBACK_CLOSED_extra'),'Not_FEEDBACK_CLOSED_extra');
});
