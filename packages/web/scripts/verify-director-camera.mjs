/**
 * 本地验证：摄像机 rotationFromPositionLookAt 与 -Z 朝向一致
 */
import { Euler, Object3D, Vector3 } from "three";

function rotationFromPositionLookAt(position, target) {
  const anchor = new Object3D();
  anchor.position.set(...position);
  const dir = new Vector3(...target).sub(anchor.position);
  if (dir.lengthSq() > 1e-8) {
    dir.normalize();
    anchor.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), dir);
  }
  return [anchor.rotation.x, anchor.rotation.y, anchor.rotation.z];
}

function forwardFromRotation(rot) {
  const euler = new Euler(rot[0], rot[1], rot[2], "XYZ");
  return new Vector3(0, 0, -1).applyEuler(euler).normalize();
}

const position = [3, 2, 5];
const target = [0, 1, 0];
const rot = rotationFromPositionLookAt(position, target);
const forward = forwardFromRotation(rot);
const expected = new Vector3(...target).sub(new Vector3(...position)).normalize();
const dot = forward.dot(expected);

console.log("rotation:", rot.map((v) => v.toFixed(4)));
console.log("forward:", forward.toArray().map((v) => v.toFixed(4)));
console.log("expected:", expected.toArray().map((v) => v.toFixed(4)));
console.log("dot(forward, expected):", dot.toFixed(6));
if (dot > 0.999) {
  console.log("PASS: camera forward matches look-at direction");
  process.exit(0);
}
console.error("FAIL: camera forward reversed or incorrect");
process.exit(1);
